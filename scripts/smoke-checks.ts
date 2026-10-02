import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ChatResponseSchema, ContextEvaluateResponseSchema, ErrorResponseSchema, GetMeResponseSchema, GetRecommendationResponseSchema, HealthResponseSchema, RealContextInputSchema, ScenarioContextInputSchema, UpdatePreferencesRequestSchema, UpdatePreferencesResponseSchema } from '@contextia/contracts';
import { getScenarioInput, scenarios } from '@contextia/test-fixtures';
import type { ContextEvaluateResponse, ScenarioId } from '@contextia/contracts';
import type { DeliveryIntent, StateRepository, UserState } from '@contextia/providers';

export const SmokeTargetSchema = z.strictObject({
  stage: z.enum(['dev', 'prod']), buildId: z.string().min(1), apiBaseUrl: z.url(), webUrl: z.url()
}).refine(target => [target.apiBaseUrl, target.webUrl].every(value => new URL(value).protocol === 'https:'), { message: 'Smoke targets must use HTTPS' });
export type SmokeTarget = z.infer<typeof SmokeTargetSchema>;
type Fetcher = typeof fetch;
type SmokeState = Pick<StateRepository, 'getState' | 'getContextSnapshot'>;
export class SmokeCheckError extends Error {}
const SAFE_PROVIDER_CODES = new Set(['TIMEOUT', 'THROTTLED', 'UPSTREAM_AUTH', 'UPSTREAM_VALIDATION', 'UPSTREAM_ERROR', 'INVALID_MODEL_OUTPUT', 'UNKNOWN_PLACE_REFERENCE', 'UNKNOWN_ROUTE_REFERENCE', 'NO_COVERAGE', 'DEMO_FORCED_UNAVAILABLE', 'GEOCODE_AMBIGUOUS', 'GEOCODE_NOT_FOUND', 'GEOCODE_LOW_CONFIDENCE', 'GEOCODE_OUT_OF_AREA', 'PLACE_STORAGE_UNAVAILABLE', 'DURATION_MISMATCH', 'DURATION_UNRESOLVED', 'NO_ROUTE', 'NO_TRANSIT_ROUTE', 'SCHEDULE_UNAVAILABLE', 'PARTIAL_DATA']);
export function smokeProviderDiagnostic(scenarioId: ScenarioId, result: ContextEvaluateResponse): string {
  return JSON.stringify({ scenarioId, requestId: /^[A-Za-z0-9_+=/-]{1,128}$/.test(result.requestId) ? result.requestId : 'redacted',
    providers: Object.fromEntries(Object.entries(result.data.providerStatus).map(([name, value]) => [name, { status: value.status, ...(value.code && SAFE_PROVIDER_CODES.has(value.code) ? { code: value.code } : {}) }])) });
}

/** Live provider proof uses a precise public destination; offline fixtures keep their deterministic facts. */
export function liveSmokeContext(scenarioId: ScenarioId, evaluationAt: Date) {
  const preset = getScenarioInput(scenarioId);
  const delta = evaluationAt.getTime() - Date.parse(preset.scenarioTime ?? preset.capturedAt);
  return ScenarioContextInputSchema.parse({ ...preset, capturedAt: evaluationAt.toISOString(), scenarioTime: evaluationAt.toISOString(),
    location: { ...preset.location, ...(scenarioId === 'early-arrival' ? { latitude: 35.658034, longitude: 139.701636 } : {}), capturedAt: evaluationAt.toISOString() },
    calendar: preset.calendar.map(event => ({ ...event,
      ...(event.location ? { location: '東京都渋谷区渋谷2丁目24番12号 渋谷駅' } : {}),
      startAt: new Date(Date.parse(event.startAt) + delta).toISOString(), endAt: new Date(Date.parse(event.endAt) + delta).toISOString() })) });
}
export function nextLiveSmokeTime(now: Date): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const slot = Date.parse(`${day}T14:10:00+09:00`);
  return new Date(slot >= now.getTime() + 10 * 60_000 ? slot : slot + 24 * 60 * 60_000);
}
/** Validated cards retain only supplied provider routes; aggregate pedestrian success alone is insufficient. */
export function hasLiveTransitProof(data: ContextEvaluateResponse['data']): boolean {
  return ['ok', 'degraded'].includes(data.providerStatus.routes.status) && data.recommendations.some(card =>
    card.route && ['transit', 'intermodal'].includes(card.route.mode) && card.route.departAt && card.route.arriveAt);
}
/** A second public case places departure inside the detector's ten-minute lead window.
 * The five presets retain their original gaps; this case still requires a real provider schedule. */
export function liveTransitProofContext(evaluationAt: Date) {
  const base = liveSmokeContext('upcoming-transit', evaluationAt);
  return ScenarioContextInputSchema.parse({ ...base, calendar: base.calendar.map(event => ({ ...event,
    location: '東京都千代田区丸の内1丁目9番1号 東京駅',
    startAt: new Date(Date.parse(event.startAt) - 10 * 60_000).toISOString(), endAt: new Date(Date.parse(event.endAt) - 10 * 60_000).toISOString() })) });
}
export function assertPreviewStateUnchanged(before: UserState | null, after: UserState | null): void {
  const delivery = (state: UserState | null) => ({ notificationsSentToday: state?.notificationsSentToday ?? 0, recentAnchors: state?.recentAnchors ?? [], latestRecommendationAt: state?.latestRecommendationAt ?? null });
  if (JSON.stringify(delivery(before)) !== JSON.stringify(delivery(after))) throw new SmokeCheckError('Preview mutated notification quota or delivery anchors');
}
export function assertWeatherFault(data: ContextEvaluateResponse['data']): void {
  if (data.delivery.mode !== 'preview' || data.delivery.status !== 'preview' || data.weather !== null
    || data.providerStatus.weather.status !== 'unavailable' || data.providerStatus.weather.code !== 'DEMO_FORCED_UNAVAILABLE'
    || data.decision !== 'notify' || data.triggerType !== 'STEP_GOAL_REST'
    || !['ok', 'degraded'].includes(data.providerStatus.places.status) || !['ok', 'degraded'].includes(data.providerStatus.bedrock.status)) {
    throw new SmokeCheckError('Dev weather fault did not preserve explicit degradation and valid step suggestions');
  }
}
export function assertProactiveTransition(before: UserState | null, after: UserState | null, data: ContextEvaluateResponse['data'], intent: DeliveryIntent | null): void {
  const expected = (before?.notificationDay === after?.notificationDay ? before?.notificationsSentToday ?? 0 : 0) + 1;
  if (data.decision !== 'notify' || data.delivery.mode !== 'proactive' || data.delivery.status !== 'ready' || data.delivery.wouldSuppress
    || !after || expected !== 1 || after.notificationsSentToday !== expected || intent?.path !== 'client' || intent.status !== 'ready') {
    throw new SmokeCheckError('Proactive evaluation did not reserve exactly one client delivery and quota increment');
  }
}
export function assertCappedProactive(before: UserState | null, after: UserState | null, data: ContextEvaluateResponse['data'], notificationDay: string): void {
  if (!before || before.notificationDay !== notificationDay || before.notificationsSentToday < 1 || data.decision !== 'silent'
    || !data.delivery.guardCodes.includes('DAILY_CAP_REACHED') || Object.values(data.providerStatus).some(value => value.status !== 'not_requested')) {
    throw new SmokeCheckError('Proactive low-frequency cap did not match persisted pre-state');
  }
  assertPreviewStateUnchanged(before, after);
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
  const evaluationAt = nextLiveSmokeTime(new Date());
  let ownershipChecked = false;
  let chatUrl: string | null = null;
  let transitProven = false;
  const readinessFailures: string[] = [];
  const ownedRead = { userId: profile.data.userId, nowEpochSeconds: Math.floor(Date.now() / 1000) };
  const before = await state.getState(ownedRead);
  if (before.status !== 'ok' && before.status !== 'degraded') throw new SmokeCheckError('Cannot read initial delivery state');
  for (const scenario of scenarios) {
    const key = randomUUID();
    // Keep preset time gaps but move obsolete fixture dates into live providers' planning window.
    const context = liveSmokeContext(scenario.id, evaluationAt);
    const request = { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: JSON.stringify(context) };
    const first = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, request));
    console.log(smokeProviderDiagnostic(scenario.id, first));
    const second = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, request));
    if (first.data.delivery.mode !== 'preview' || first.data.delivery.status !== 'preview') throw new SmokeCheckError('Scenario smoke did not use preview');
    if (first.requestId === second.requestId || JSON.stringify(first.data) !== JSON.stringify(second.data)) throw new SmokeCheckError('Idempotency replay did not preserve the result with a fresh request ID');
    if (scenario.id === 'upcoming-transit') transitProven = hasLiveTransitProof(first.data);
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
  if (!transitProven) {
    const proof = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, { method: 'POST', headers: { ...headers, 'idempotency-key': randomUUID() }, body: JSON.stringify(liveTransitProofContext(evaluationAt)) }));
    console.log(smokeProviderDiagnostic('upcoming-transit', proof));
    if (!hasLiveTransitProof(proof.data)) readinessFailures.push(`Live scheduled transit card is not ready: ${smokeProviderDiagnostic('upcoming-transit', proof)}`);
    const after = await state.getState(ownedRead);
    if (after.status !== 'ok' && after.status !== 'degraded') throw new SmokeCheckError('Cannot verify transit preview delivery state');
    assertPreviewStateUnchanged(before.data, after.data);
  }
  if (readinessFailures.length) throw new SmokeCheckError(readinessFailures.join('; '));
  if (!ownershipChecked) throw new SmokeCheckError('No recommendation was available to prove the ownership boundary');
  if (chatUrl) {
    const chat = ChatResponseSchema.parse(await json(fetcher, chatUrl, { method: 'POST', headers, body: JSON.stringify({ message: 'この推薦について、場所の候補を短く教えてください。' }) }));
    const remaining = Date.parse(chat.data.expiresAt) - Date.now();
    if (remaining <= 0 || remaining > 7200_000) throw new SmokeCheckError('Conversation expiry exceeded two hours');
  }
  const fault = await response(fetcher, `${api}/v1/context/evaluate`, { method: 'POST', headers: { ...headers,
    'idempotency-key': randomUUID(), 'X-Contextia-Demo-Fault': 'weather' }, body: JSON.stringify(liveSmokeContext('step-goal', evaluationAt)) });
  if (target.stage === 'prod') {
    if (fault.status !== 403) throw new SmokeCheckError('Production accepted the dev fault selector');
  } else {
    if (!fault.ok) throw new SmokeCheckError('Dev fault preview failed');
    const result = ContextEvaluateResponseSchema.parse(await fault.json() as unknown);
    assertWeatherFault(result.data);
    console.log(smokeProviderDiagnostic('step-goal', result));
    const after = await state.getState(ownedRead);
    if (after.status !== 'ok' && after.status !== 'degraded') throw new SmokeCheckError('Cannot verify fault preview delivery state');
    assertPreviewStateUnchanged(before.data, after.data);
  }
}

/** Dedicated dev user and synthetic public context; this is an API/counter gate, not native sensor proof. */
export async function runProactiveSmoke(target: SmokeTarget, tokens: { webAccessToken: string; mobileAccessToken: string }, state: Pick<StateRepository, 'getState' | 'getDeliveryIntent'>, fetcher: Fetcher = fetch): Promise<void> {
  if (target.stage !== 'dev') throw new SmokeCheckError('Synthetic proactive smoke is dev only');
  const api = target.apiBaseUrl.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${tokens.mobileAccessToken}`, 'content-type': 'application/json' };
  const profile = GetMeResponseSchema.parse(await json(fetcher, `${api}/v1/me`, { headers }));
  const webProfile = GetMeResponseSchema.parse(await json(fetcher, `${api}/v1/me`, { headers: { authorization: `Bearer ${tokens.webAccessToken}` } }));
  if (profile.data.userId !== webProfile.data.userId) throw new SmokeCheckError('Mobile SRP smoke must use the same dedicated user as Web smoke');
  const readState = async () => {
    const result = await state.getState({ userId: profile.data.userId, nowEpochSeconds: Math.floor(Date.now() / 1000) });
    if (result.status !== 'ok' && result.status !== 'degraded') throw new SmokeCheckError('Proactive persisted state unavailable');
    return result.data;
  };
  const updatePreferences = async (preferences: typeof profile.data.preferences) => {
    UpdatePreferencesResponseSchema.parse(await json(fetcher, `${api}/v1/me/preferences`, { method: 'PUT', headers, body: JSON.stringify(preferences) }));
  };
  const at = new Date(); const preset = liveSmokeContext('step-goal', at);
  const real = RealContextInputSchema.parse({ mode: 'real', deliveryMode: 'proactive', capturedAt: preset.capturedAt,
    location: preset.location, calendar: preset.calendar,
    activity: { ...preset.activity, stepGoal: profile.data.preferences.stepGoal, stepsToday: Math.max(10432, profile.data.preferences.stepGoal), stepGoalReached: true } });
  const request = { method: 'POST', headers: { ...headers, 'idempotency-key': randomUUID() }, body: JSON.stringify(real) };
  const denied = await response(fetcher, `${api}/v1/context/evaluate`, { ...request, headers: { ...request.headers, authorization: `Bearer ${tokens.webAccessToken}` } });
  if (denied.status !== 403) throw new SmokeCheckError('Web client accepted proactive real context');
  try {
    await updatePreferences({ ...profile.data.preferences, notificationsEnabled: true, notificationFrequency: 'low' });
    const before = await readState();
    const notificationDay = new Intl.DateTimeFormat('en-CA', { timeZone: profile.data.preferences.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const first = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, request));
    const after = await readState();
    if (first.data.decision === 'notify') {
      const intent = await state.getDeliveryIntent({ userId: profile.data.userId, recommendationId: first.data.recommendationId, nowEpochSeconds: Math.floor(Date.now() / 1000) });
      if (intent.status !== 'ok' && intent.status !== 'degraded') throw new SmokeCheckError('Client delivery reservation unavailable');
      assertProactiveTransition(before, after, first.data, intent.data);
    } else {
      assertCappedProactive(before, after, first.data, notificationDay);
    }
    const replay = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, request));
    if (first.requestId === replay.requestId || JSON.stringify(first.data) !== JSON.stringify(replay.data)) throw new SmokeCheckError('Proactive idempotency replay changed the evaluation');
    assertPreviewStateUnchanged(after, await readState());
    const duplicate = ContextEvaluateResponseSchema.parse(await json(fetcher, `${api}/v1/context/evaluate`, { ...request, headers: { ...headers, 'idempotency-key': randomUUID() } }));
    if (duplicate.data.decision !== 'silent' || !duplicate.data.delivery.guardCodes.includes('DUPLICATE_CONTEXT')
      || !duplicate.data.delivery.guardCodes.includes('DAILY_CAP_REACHED') || Object.values(duplicate.data.providerStatus).some(value => value.status !== 'not_requested')) throw new SmokeCheckError('Proactive duplicate/cap guards did not stop provider calls');
    assertPreviewStateUnchanged(after, await readState());
    console.log(`Dev Mobile SRP/proactive gate passed (${first.data.decision === 'notify' ? 'one client reservation and quota increment' : 'existing daily cap preserved'}; replay and duplicate suppressed).`);
  } finally { await updatePreferences(profile.data.preferences); }
}
