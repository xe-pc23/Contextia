import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ChatResponseSchema, ContextEvaluateResponseSchema, ErrorResponseSchema, GetMeResponseSchema, GetRecommendationResponseSchema, HealthResponseSchema, UpdatePreferencesRequestSchema, UpdatePreferencesResponseSchema } from '@contextia/contracts';
import { getScenarioInput, scenarios } from '@contextia/test-fixtures';
import type { ContextEvaluateResponse, ScenarioId } from '@contextia/contracts';
import type { StateRepository, UserState } from '@contextia/providers';

export const SmokeTargetSchema = z.strictObject({
  stage: z.enum(['dev', 'prod']), buildId: z.string().min(1), apiBaseUrl: z.url(), webUrl: z.url()
}).refine(target => [target.apiBaseUrl, target.webUrl].every(value => new URL(value).protocol === 'https:'), { message: 'Smoke targets must use HTTPS' });
export type SmokeTarget = z.infer<typeof SmokeTargetSchema>;
type Fetcher = typeof fetch;
type SmokeState = Pick<StateRepository, 'getState' | 'getContextSnapshot'>;
export class SmokeCheckError extends Error {}
const SAFE_PROVIDER_CODES = new Set(['TIMEOUT', 'THROTTLED', 'UPSTREAM_AUTH', 'UPSTREAM_VALIDATION', 'UPSTREAM_ERROR', 'INVALID_MODEL_OUTPUT', 'UNKNOWN_PLACE_REFERENCE', 'UNKNOWN_ROUTE_REFERENCE', 'NO_COVERAGE', 'DEMO_FORCED_UNAVAILABLE', 'GEOCODE_AMBIGUOUS', 'PLACE_STORAGE_UNAVAILABLE']);
export function smokeProviderDiagnostic(scenarioId: ScenarioId, result: ContextEvaluateResponse): string {
  return JSON.stringify({ scenarioId, requestId: /^[A-Za-z0-9_-]{1,128}$/.test(result.requestId) ? result.requestId : 'redacted',
    providers: Object.fromEntries(Object.entries(result.data.providerStatus).map(([name, value]) => [name, { status: value.status, ...(value.code && SAFE_PROVIDER_CODES.has(value.code) ? { code: value.code } : {}) }])) });
}
export function assertPreviewStateUnchanged(before: UserState | null, after: UserState | null): void {
  const delivery = (state: UserState | null) => ({ notificationsSentToday: state?.notificationsSentToday ?? 0, recentAnchors: state?.recentAnchors ?? [], latestRecommendationAt: state?.latestRecommendationAt ?? null });
  if (JSON.stringify(delivery(before)) !== JSON.stringify(delivery(after))) throw new SmokeCheckError('Preview mutated notification quota or delivery anchors');
}
async function initializeProfile(api: string, token: string, fetcher: Fetcher): Promise<void> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const current = await response(fetcher, `${api}/v1/me`, { headers });
  if (current.ok) { GetMeResponseSchema.parse(await current.json() as unknown); return; }
  const failure = ErrorResponseSchema.safeParse(await current.json() as unknown);
  if (current.status !== 404 || !failure.success || failure.data.error.code !== 'PROFILE_NOT_FOUND') throw new SmokeCheckError('Smoke profile lookup failed');
  const preferences = UpdatePreferencesRequestSchema.parse({ interests: ['cafe', 'park'], stepGoal: 10000, notificationFrequency: 'normal', notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo' });
  UpdatePreferencesResponseSchema.parse(await json(fetcher, `${api}/v1/me/preferences`, { method: 'PUT', headers, body: JSON.stringify(preferences) }));
}

async function response(fetcher: Fetcher, url: string, init?: RequestInit): Promise<Response> {
  return fetcher(url, { ...init, signal: AbortSignal.timeout(35_000), redirect: 'error' });
}
async function json(fetcher: Fetcher, url: string, init?: RequestInit): Promise<unknown> {
  const result = await response(fetcher, url, init);
  if (!result.ok) throw new SmokeCheckError(`Smoke request failed with HTTP ${result.status}`);
  return result.json() as Promise<unknown>;
}

export async function runPublicSmoke(input: SmokeTarget, fetcher: Fetcher = fetch): Promise<void> {
  const target = SmokeTargetSchema.parse(input);
  const api = target.apiBaseUrl.replace(/\/$/, '');
  const web = target.webUrl.replace(/\/$/, '');
  const health = HealthResponseSchema.parse(await json(fetcher, `${api}/health`));
  if (health.version !== target.buildId) throw new SmokeCheckError('API build ID does not match the deployed SHA');
  const config = z.object({ stage: z.enum(['dev', 'prod']), buildId: z.string(), apiBaseUrl: z.url() }).parse(await json(fetcher, `${web}/config.json`));
  if (config.stage !== target.stage || config.buildId !== target.buildId || config.apiBaseUrl.replace(/\/$/, '') !== api) throw new SmokeCheckError('Web runtime config does not match stage/API/deployed SHA');
  const page = await response(fetcher, `${web}/`);
  if (!page.ok) throw new SmokeCheckError('Public web page is unavailable');
  const html = await page.text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1]).filter((value): value is string => value !== undefined);
  if (!scripts.length) throw new SmokeCheckError('Built web entry has no JavaScript asset');
  for (const src of scripts) {
    const asset = new URL(src, `${web}/`);
    if (asset.origin !== new URL(web).origin) throw new SmokeCheckError('Unexpected external script in web entry');
    const result = await response(fetcher, asset.href);
    if (!result.ok || !(result.headers.get('content-type') ?? '').includes('javascript') || !(await result.text()).trim()) throw new SmokeCheckError('Built JavaScript asset is unavailable');
  }
  const protectedResponse = await response(fetcher, `${api}/v1/me`);
  if (protectedResponse.status !== 401) throw new SmokeCheckError('Protected API did not reject an unauthenticated request');
}

/** Tokens are caller-supplied transient access tokens; never printed or written to artifacts. */
export async function runAuthenticatedSmoke(target: SmokeTarget, tokens: { accessToken: string; secondUserToken: string }, fetcher: Fetcher = fetch, state?: SmokeState): Promise<void> {
  if (!state) throw new SmokeCheckError('Authenticated smoke requires persisted state verification');
  const api = target.apiBaseUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${tokens.accessToken}`, 'content-type': 'application/json' };
  await Promise.all([initializeProfile(api, tokens.accessToken, fetcher), initializeProfile(api, tokens.secondUserToken, fetcher)]);
  const profile = GetMeResponseSchema.parse(await json(fetcher, `${api}/v1/me`, { headers }));
  const other = GetMeResponseSchema.parse(await json(fetcher, `${api}/v1/me`, { headers: { authorization: `Bearer ${tokens.secondUserToken}` } }));
  if (profile.data.userId === other.data.userId) throw new SmokeCheckError('Ownership smoke needs two distinct user accounts');
  const evaluationAt = new Date(Date.now() + 10 * 60_000);
  let ownershipChecked = false;
  let chatUrl: string | null = null;
  const readinessFailures: string[] = [];
  const ownedRead = { userId: profile.data.userId, nowEpochSeconds: Math.floor(Date.now() / 1000) };
  const before = await state.getState(ownedRead);
  if (before.status !== 'ok' && before.status !== 'degraded') throw new SmokeCheckError('Cannot read initial delivery state');
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
    console.log(smokeProviderDiagnostic(scenario.id, first));
    const second = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, request));
    if (first.data.delivery.mode !== 'preview' || first.data.delivery.status !== 'preview') throw new SmokeCheckError('Scenario smoke did not use preview');
    if (first.requestId === second.requestId || JSON.stringify(first.data) !== JSON.stringify(second.data)) throw new SmokeCheckError('Idempotency replay did not preserve the result with a fresh request ID');
    if (scenario.id === 'upcoming-transit' && !['ok', 'degraded'].includes(first.data.providerStatus.routes.status)) readinessFailures.push(`Live transit route provider is not ready: ${smokeProviderDiagnostic(scenario.id, first)}`);
    if (scenario.id === 'step-goal' && (first.data.decision !== 'notify' || first.data.triggerType !== 'STEP_GOAL_REST' || !['ok', 'degraded'].includes(first.data.providerStatus.places.status) || !['ok', 'degraded'].includes(first.data.providerStatus.bedrock.status))) readinessFailures.push(`Step-goal live Places/Bedrock slice is not ready: ${smokeProviderDiagnostic(scenario.id, first)}`);
    const fresh = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, { ...request, headers: { ...headers, 'idempotency-key': randomUUID() } }));
    if (fresh.data.evaluationId === first.data.evaluationId || fresh.data.delivery.mode !== 'preview' || fresh.data.delivery.status !== 'preview' || !fresh.data.delivery.guardCodes.includes('DUPLICATE_CONTEXT') || !fresh.data.delivery.wouldSuppress) throw new SmokeCheckError('Fresh repeated preview did not expose duplicate diagnostics');
    const after = await state.getState(ownedRead);
    if ((after.status !== 'ok' && after.status !== 'degraded') || !after.data?.latestContext || after.data.latestContext.evaluationId !== fresh.data.evaluationId) throw new SmokeCheckError('Fresh evaluation context was not persisted');
    assertPreviewStateUnchanged(before.data, after.data);
    const snapshot = await state.getContextSnapshot({ ...ownedRead, reference: after.data.latestContext });
    if ((snapshot.status !== 'ok' && snapshot.status !== 'degraded') || !snapshot.data || snapshot.data.mode !== 'simulation') throw new SmokeCheckError('Persisted preview snapshot is unavailable');
    if (first.data.recommendationId) {
      const url = `${api}/v1/recommendations/${encodeURIComponent(first.data.recommendationId)}`;
      GetRecommendationResponseSchema.parse(await json(fetcher, url, { headers }));
      const denied = await response(fetcher, url, { headers: { authorization: `Bearer ${tokens.secondUserToken}` } });
      if (denied.status !== 404) throw new SmokeCheckError('Another user could access a recommendation');
      const chatDenied = await response(fetcher, `${url}/chat`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${tokens.secondUserToken}` }, body: JSON.stringify({ message: 'この推薦について教えてください。' }) });
      if (chatDenied.status !== 404) throw new SmokeCheckError('Another user could chat about a recommendation');
      chatUrl ??= `${url}/chat`;
      ownershipChecked = true;
    }
  }
  if (readinessFailures.length) throw new SmokeCheckError(readinessFailures.join('; '));
  if (!ownershipChecked) throw new SmokeCheckError('No recommendation was available to prove the ownership boundary');
  if (chatUrl) {
    const chat = ChatResponseSchema.parse(await json(fetcher, chatUrl, { method: 'POST', headers, body: JSON.stringify({ message: 'この推薦について、場所の候補を短く教えてください。' }) }));
    const remaining = Date.parse(chat.data.expiresAt) - Date.now();
    if (remaining <= 0 || remaining > 7200_000) throw new SmokeCheckError('Conversation expiry exceeded two hours');
  }
}
