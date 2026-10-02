import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContextEvaluateResponseSchema, GetMeResponseSchema, GetRecommendationResponseSchema, HealthResponseSchema } from '@contextia/contracts';
import { getScenarioInput, scenarios } from '@contextia/test-fixtures';

export const SmokeTargetSchema = z.strictObject({
  stage: z.enum(['dev', 'prod']), buildId: z.string().min(1), apiBaseUrl: z.url(), webUrl: z.url()
}).refine(target => [target.apiBaseUrl, target.webUrl].every(value => new URL(value).protocol === 'https:'), { message: 'Smoke targets must use HTTPS' });
export type SmokeTarget = z.infer<typeof SmokeTargetSchema>;
type Fetcher = typeof fetch;

async function response(fetcher: Fetcher, url: string, init?: RequestInit): Promise<Response> {
  return fetcher(url, { ...init, signal: AbortSignal.timeout(35_000), redirect: 'error' });
}
async function json(fetcher: Fetcher, url: string, init?: RequestInit): Promise<unknown> {
  const result = await response(fetcher, url, init);
  if (!result.ok) throw new Error(`Smoke request failed with HTTP ${result.status}`);
  return result.json() as Promise<unknown>;
}

export async function runPublicSmoke(input: SmokeTarget, fetcher: Fetcher = fetch): Promise<void> {
  const target = SmokeTargetSchema.parse(input);
  const api = target.apiBaseUrl.replace(/\/$/, '');
  const web = target.webUrl.replace(/\/$/, '');
  const health = HealthResponseSchema.parse(await json(fetcher, `${api}/health`));
  if (health.version !== target.buildId) throw new Error('API build ID does not match the deployed SHA');
  const config = z.object({ stage: z.enum(['dev', 'prod']), buildId: z.string(), apiBaseUrl: z.url() }).parse(await json(fetcher, `${web}/config.json`));
  if (config.stage !== target.stage || config.buildId !== target.buildId || config.apiBaseUrl.replace(/\/$/, '') !== api) throw new Error('Web runtime config does not match stage/API/deployed SHA');
  const page = await response(fetcher, `${web}/`);
  if (!page.ok) throw new Error('Public web page is unavailable');
  const html = await page.text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1]).filter((value): value is string => value !== undefined);
  if (!scripts.length) throw new Error('Built web entry has no JavaScript asset');
  for (const src of scripts) {
    const asset = new URL(src, `${web}/`);
    if (asset.origin !== new URL(web).origin) throw new Error('Unexpected external script in web entry');
    const result = await response(fetcher, asset.href);
    if (!result.ok || !(result.headers.get('content-type') ?? '').includes('javascript') || !(await result.text()).trim()) throw new Error('Built JavaScript asset is unavailable');
  }
  const protectedResponse = await response(fetcher, `${api}/v1/me`);
  if (protectedResponse.status !== 401) throw new Error('Protected API did not reject an unauthenticated request');
}

/** Tokens are caller-supplied transient access tokens; never printed or written to artifacts. */
export async function runAuthenticatedSmoke(target: SmokeTarget, tokens: { accessToken: string; secondUserToken: string }, fetcher: Fetcher = fetch): Promise<void> {
  const api = target.apiBaseUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${tokens.accessToken}`, 'content-type': 'application/json' };
  const profile = GetMeResponseSchema.parse(await json(fetcher, `${api}/v1/me`, { headers }));
  const other = GetMeResponseSchema.parse(await json(fetcher, `${api}/v1/me`, { headers: { authorization: `Bearer ${tokens.secondUserToken}` } }));
  if (profile.data.userId === other.data.userId) throw new Error('Ownership smoke needs two distinct user accounts');
  const evaluationAt = new Date(Date.now() + 10 * 60_000);
  let ownershipChecked = false;
  for (const scenario of scenarios) {
    const key = randomUUID();
    // Keep preset time gaps but move obsolete fixture dates into live providers' planning window.
    const preset = getScenarioInput(scenario.id);
    const delta = evaluationAt.getTime() - Date.parse(preset.scenarioTime ?? preset.capturedAt);
    const context = { ...preset, capturedAt: evaluationAt.toISOString(), scenarioTime: evaluationAt.toISOString(),
      location: { ...preset.location, capturedAt: evaluationAt.toISOString() },
      calendar: preset.calendar.map(event => ({ ...event, startAt: new Date(Date.parse(event.startAt) + delta).toISOString(), endAt: new Date(Date.parse(event.endAt) + delta).toISOString() })) };
    const request = { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: JSON.stringify(context) };
    const first = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, request));
    const second = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, request));
    if (first.data.delivery.mode !== 'preview' || first.data.delivery.status !== 'preview') throw new Error('Scenario smoke did not use preview');
    if (first.requestId === second.requestId || JSON.stringify(first.data) !== JSON.stringify(second.data)) throw new Error('Idempotency replay did not preserve the result with a fresh request ID');
    if (scenario.id === 'upcoming-transit' && !['ok', 'degraded'].includes(first.data.providerStatus.routes.status)) throw new Error('Live transit route provider is not ready');
    if (first.data.recommendationId) {
      const url = `${api}/v1/recommendations/${encodeURIComponent(first.data.recommendationId)}`;
      GetRecommendationResponseSchema.parse(await json(fetcher, url, { headers }));
      const denied = await response(fetcher, url, { headers: { authorization: `Bearer ${tokens.secondUserToken}` } });
      if (denied.status !== 404) throw new Error('Another user could access a recommendation');
      ownershipChecked = true;
    }
  }
  if (!ownershipChecked) throw new Error('No recommendation was available to prove the ownership boundary');
}
