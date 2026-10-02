import { EvaluationResultSchema, RecommendationDecisionSchema, UserPreferencesSchema } from '@contextia/contracts';
import type {
  ApiRecommendationItem, CandidateOpportunity, ContextInput, DeliveryDiagnostics, EvaluationResult, GuardCode,
  NotifyDecision, Place, ProviderPlace, ProviderResult, ProviderStatus, ProviderStatusMap, UserPreferences
} from '@contextia/contracts';
import type {
  ContextSnapshot, PlacesProvider, ProviderEnrichment, RecommendationModel, RecommendationSummary,
  RecommendationWrite, StateRepository, StoragePlace, StorageRecommendationItem
} from '@contextia/providers';
import type { EvaluationDomain, GuardCheckInput, GuardUserState } from './evaluationDomain.js';
import { contextFingerprint, hashCalendarId } from './fingerprint.js';

export type EvaluationFailureCode = 'PROFILE_NOT_FOUND' | 'STATE_UNAVAILABLE';

/** Expected failures the handler maps to HTTP errors. Anything else is an internal error. */
export class EvaluationFailure extends Error {
  constructor(readonly code: EvaluationFailureCode) {
    super(code);
    this.name = 'EvaluationFailure';
  }
}

export interface EvaluationPolicy {
  contextTtlSeconds: number;
  recommendationTtlSeconds: number;
  contextDedupSeconds: number;
  maxRecentAnchors: number;
  nearbyRadiusMeters: number;
  nearbyMaxResults: number;
  placesTimeoutMs: number;
  modelTimeoutMs: number;
  recentRecommendationLimit: number;
}

export const defaultEvaluationPolicy: EvaluationPolicy = Object.freeze({
  contextTtlSeconds: 24 * 60 * 60,
  recommendationTtlSeconds: 7 * 24 * 60 * 60,
  contextDedupSeconds: 300,
  maxRecentAnchors: 20,
  nearbyRadiusMeters: 800,
  nearbyMaxResults: 10,
  placesTimeoutMs: 2500,
  modelTimeoutMs: 7000,
  recentRecommendationLimit: 5
});

export type EvaluationStateRepository = Pick<StateRepository,
  'getProfile' | 'getState' | 'writeContextSnapshot' | 'getContextSnapshot' | 'listRecommendations' | 'writeRecommendation' | 'commitProactiveRecommendation'>;

export interface EvaluationDependencies {
  domain: EvaluationDomain;
  state: EvaluationStateRepository;
  places: PlacesProvider;
  model: Pick<RecommendationModel, 'decide'>;
  clock: () => Date;
  newId: (prefix: 'eval' | 'rec' | 'item') => string;
  policy?: EvaluationPolicy;
}

export interface EvaluateContextInput { userId: string; context: ContextInput }
export type EvaluateContext = (input: EvaluateContextInput) => Promise<EvaluationResult>;

const NOT_REQUESTED: ProviderStatus = { status: 'not_requested' };
// Phase 1 connects only nearby Places; other needs are reported, never fabricated.
const UNCONNECTED: ProviderStatus = { status: 'unavailable', code: 'PROVIDER_NOT_CONNECTED' };

function statusOf(result: ProviderResult<unknown>): ProviderStatus {
  return {
    status: result.status,
    ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
    ...(result.code === undefined ? {} : { code: result.code })
  };
}

async function withTimeout<T>(run: () => Promise<ProviderResult<T>>, timeoutMs: number): Promise<ProviderResult<T>> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ProviderResult<T>>(resolve => {
    timer = setTimeout(() => { resolve({ status: 'timeout', data: null }); }, timeoutMs);
  });
  const call = run().catch((): ProviderResult<T> => ({ status: 'error', data: null, code: 'PROVIDER_EXCEPTION' }));
  try {
    const result = await Promise.race([call, timeout]);
    return { ...result, latencyMs: result.latencyMs ?? Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

function toPlace(place: ProviderPlace): Place {
  return {
    provider: place.provider, placeId: place.placeId, name: place.name, latitude: place.latitude, longitude: place.longitude,
    ...(place.distanceMeters === undefined ? {} : { distanceMeters: place.distanceMeters })
  };
}

function epochSeconds(date: Date, plusSeconds = 0): number {
  return Math.floor(date.getTime() / 1000) + plusSeconds;
}

function effectivePreferences(stored: UserPreferences, context: ContextInput): UserPreferences {
  // Only Scenario Console simulations may override preferences; real delivery uses the stored profile.
  if (context.mode !== 'simulation' || !context.preferencesOverride) return stored;
  const overrides = Object.entries(context.preferencesOverride).filter(([, value]) => value !== undefined);
  return UserPreferencesSchema.parse({ ...stored, ...Object.fromEntries(overrides) });
}

function snapshotOf(context: ContextInput, evaluationId: string, now: Date, expiresAt: number): ContextSnapshot {
  const { latitude, longitude, accuracyMeters } = context.location;
  const steps = context.activity?.stepsToday;
  const confidence = context.activity?.confidence;
  return {
    evaluationId, capturedAt: context.capturedAt, mode: context.mode,
    location: { latitude, longitude, ...(accuracyMeters === undefined ? {} : { accuracyMeters }) },
    ...(context.activity ? { activity: { ...(steps === undefined ? {} : { stepsToday: steps }), ...(confidence ? { confidence } : {}) } } : {}),
    calendar: context.calendar.map(event => ({ ...event, id: hashCalendarId(event.id) })),
    createdAt: now.toISOString(), expiresAt
  };
}

function delivery(context: ContextInput, guardCodes: GuardCode[], silent: boolean): DeliveryDiagnostics {
  const codes = [...new Set(guardCodes)];
  if (context.deliveryMode === 'preview') return { mode: 'preview', status: 'preview', wouldSuppress: codes.length > 0, guardCodes: codes };
  return { mode: 'proactive', status: silent ? 'suppressed' : 'ready', wouldSuppress: codes.length > 0, guardCodes: codes };
}

/**
 * Legacy-row fallback for Issue #5: older state items may have a fingerprint but no processed time.
 * New snapshots persist that time on `UserState`; only matching legacy fingerprints need this read.
 */
async function resolveGuardState(
  repository: EvaluationStateRepository, userId: string, nowEpochSeconds: number, state: GuardUserState | null, fingerprint: string
): Promise<GuardUserState | null> {
  if (!state || state.latestContextFingerprint !== fingerprint || state.latestContextProcessedAt) return state;
  // A fingerprint without its snapshot reference is inconsistent state: fail closed.
  if (!state.latestContext) throw new EvaluationFailure('STATE_UNAVAILABLE');
  const snapshot = await repository.getContextSnapshot({ userId, nowEpochSeconds, reference: state.latestContext });
  if (snapshot.status !== 'ok' && snapshot.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
  if (!snapshot.data) {
    // The snapshot outlived the dedup window (TTL is checked at construction), so the fingerprint is stale.
    const { latestContextFingerprint, ...rest } = state;
    void latestContextFingerprint;
    return rest;
  }
  return { ...state, latestContextProcessedAt: snapshot.data.createdAt };
}

type ValidatedNotify = { decision: NotifyDecision; places: Map<string, ProviderPlace> };

/** Model output may only reference places supplied in its input, and Phase 1 supplies no routes. */
function validateDecision(raw: unknown, supplied: ProviderPlace[]): { ok: true; value: ValidatedNotify | null } | { ok: false; code: string } {
  const parsed = RecommendationDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_MODEL_OUTPUT' };
  if (parsed.data.decision === 'silent') return { ok: true, value: null };
  const places = new Map(supplied.map(place => [place.placeId, place]));
  for (const item of parsed.data.recommendations) {
    if (item.place && !places.has(item.place.placeId)) return { ok: false, code: 'UNKNOWN_PLACE_REFERENCE' };
    if (item.route) return { ok: false, code: 'UNKNOWN_ROUTE_REFERENCE' };
  }
  return { ok: true, value: { decision: parsed.data, places } };
}

export function createEvaluateContext(deps: EvaluationDependencies): EvaluateContext {
  const policy = deps.policy ?? defaultEvaluationPolicy;
  if (policy.contextTtlSeconds <= policy.contextDedupSeconds) {
    throw new RangeError('contextTtlSeconds must exceed contextDedupSeconds so an expired snapshot is never a recent duplicate');
  }

  return async ({ userId, context }) => {
    // One request-start instant keeps both guard passes on the same day and window.
    const now = deps.clock();
    const nowEpochSeconds = epochSeconds(now);
    const evaluationId = deps.newId('eval');
    const contextExpiresAt = epochSeconds(now, policy.contextTtlSeconds);

    const profile = await deps.state.getProfile({ userId });
    if (profile.status !== 'ok' && profile.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
    if (!profile.data) throw new EvaluationFailure('PROFILE_NOT_FOUND');
    const preferences = effectivePreferences(profile.data.preferences, context);

    const stateResult = await deps.state.getState({ userId, nowEpochSeconds });
    if (stateResult.status !== 'ok' && stateResult.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
    const fingerprint = contextFingerprint(context);
    const state = await resolveGuardState(deps.state, userId, nowEpochSeconds, stateResult.data, fingerprint);
    const guardBase: GuardCheckInput = { now, deliveryMode: context.deliveryMode, preferences, state, contextFingerprint: fingerprint };
    const pre = deps.domain.checkDeliveryGuards(guardBase);

    // Prior state was read above; record this context (including preview) before any provider work.
    const written = await deps.state.writeContextSnapshot({
      userId, snapshot: snapshotOf(context, evaluationId, now, contextExpiresAt), fingerprint,
      processedAt: now.toISOString(), notificationDay: pre.notificationDay
    });
    if (written.status !== 'ok' && written.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');

    const providerStatus: ProviderStatusMap = {
      geocoding: NOT_REQUESTED, places: NOT_REQUESTED, weather: NOT_REQUESTED, routes: NOT_REQUESTED, bedrock: NOT_REQUESTED
    };
    const base = { evaluationId, contextExpiresAt: new Date(contextExpiresAt * 1000).toISOString() };
    const silent = (decisionReason: string, guardCodes: GuardCode[], usedSignals: EvaluationResult['usedSignals'] = []): EvaluationResult =>
      EvaluationResultSchema.parse({
        ...base, decision: 'silent', recommendationId: null, triggerType: null, urgency: null, message: null, recommendations: [],
        decisionReason, usedSignals, delivery: delivery(context, guardCodes, true), providerStatus
      });

    if (!pre.shouldEvaluate) return silent('Delivery guards suppressed this evaluation.', pre.guardCodes);

    const candidates = await deps.domain.detectCandidates({ context, preferences, now });
    if (candidates.length === 0) return silent('No candidate opportunity was detected.', [...pre.guardCodes, 'NO_CANDIDATE']);

    const checked = candidates.map(candidate => ({
      candidate, guard: deps.domain.checkDeliveryGuards({ ...guardBase, opportunity: { type: candidate.type, anchorKey: candidate.anchorKey } })
    }));
    const viable = checked.filter(entry => entry.guard.shouldEvaluate);
    const candidateGuardCodes = checked.flatMap(entry => entry.guard.guardCodes);
    if (viable.length === 0) return silent('Delivery guards suppressed every candidate.', [...pre.guardCodes, ...candidateGuardCodes]);
    // Preview keeps every candidate and reports what proactive delivery would have suppressed.
    const previewCodes: GuardCode[] = context.deliveryMode === 'preview' ? [...pre.guardCodes, ...candidateGuardCodes] : [];

    const needs = new Set(viable.flatMap(entry => entry.candidate.providerNeeds));
    const enrichment: ProviderEnrichment = { geocoding: [], places: [], weather: [], routes: [] };
    let nearby: ProviderPlace[] = [];
    if (needs.has('places-near-current')) {
      const result = await withTimeout(() => deps.places.searchNearby({
        position: { latitude: context.location.latitude, longitude: context.location.longitude },
        radiusMeters: policy.nearbyRadiusMeters, maxResults: policy.nearbyMaxResults,
        locale: preferences.locale, persistenceIntent: 'single-use'
      }), policy.placesTimeoutMs);
      providerStatus.places = statusOf(result);
      enrichment.places.push({ need: 'places-near-current', anchorKey: 'current', result });
      nearby = result.data ?? [];
    }
    if (needs.has('geocode-event-location')) providerStatus.geocoding = UNCONNECTED;
    if (needs.has('places-near-destination') && providerStatus.places.status === 'not_requested') providerStatus.places = UNCONNECTED;
    if (needs.has('weather-current') || needs.has('weather-today')) providerStatus.weather = UNCONNECTED;
    if (needs.has('route-to-next-event') || needs.has('route-to-place-candidates')) providerStatus.routes = UNCONNECTED;

    const recent = await deps.state.listRecommendations({ userId, nowEpochSeconds, limit: policy.recentRecommendationLimit });
    const recentRecommendations: RecommendationSummary[] = (recent.data?.items ?? []).map(item => ({
      recommendationId: item.id, triggerType: item.triggerType, createdAt: item.createdAt, summary: item.summaryForDedup
    }));

    const viableCandidates: CandidateOpportunity[] = viable.map(entry => entry.candidate);
    const decided = await withTimeout(() => deps.model.decide({
      context, now: now.toISOString(), preferences, candidates: viableCandidates, enrichment, recentRecommendations
    }), policy.modelTimeoutMs);
    if (decided.status !== 'ok' && decided.status !== 'degraded') {
      providerStatus.bedrock = statusOf(decided);
      return silent('The recommendation model was unavailable.', [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY']);
    }
    const validated = validateDecision(decided.data, nearby);
    if (!validated.ok) {
      providerStatus.bedrock = { ...statusOf(decided), status: 'error', code: validated.code };
      return silent('The recommendation model returned an unusable decision.', [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY']);
    }
    providerStatus.bedrock = statusOf(decided);
    if (!validated.value) {
      return silent(decided.data.decisionReason, [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY'], decided.data.usedSignals);
    }
    const { decision, places } = validated.value;

    // The model does not name a trigger; Phase 1 attributes the decision to the most confident viable candidate.
    const chosen = viable.reduce((best, entry) => entry.candidate.confidence > best.candidate.confidence ? entry : best);
    const recommendationId = deps.newId('rec');
    const proactive = context.deliveryMode === 'proactive';

    // Response items show provider-normalized places; only Storage-intent lookups may be persisted.
    const items = await Promise.all(decision.recommendations.map(async item => {
      const id = deps.newId('item');
      const supplied = item.place ? places.get(item.place.placeId) : undefined;
      const place = supplied ? toPlace(supplied) : null;
      let storagePlace: StoragePlace | null = null;
      if (supplied) {
        const stored = await withTimeout(() => deps.places.getPlace({
          placeId: supplied.placeId, locale: preferences.locale, persistenceIntent: 'storage'
        }), policy.placesTimeoutMs);
        storagePlace = stored.data;
      }
      const api: ApiRecommendationItem = { id, title: item.title, reason: item.reason, place, route: null, action: item.action };
      const storage: StorageRecommendationItem = { ...api, place: storagePlace };
      return { api, storage };
    }));

    const createdAt = now.toISOString();
    const recommendation: RecommendationWrite = {
      id: recommendationId, evaluationId, contextReference: { evaluationId, capturedAt: context.capturedAt }, createdAt,
      triggerType: chosen.candidate.type, urgency: decision.urgency, message: decision.message,
      recommendations: items.map(item => item.storage), usedSignals: decision.usedSignals,
      summaryForDedup: decision.message.slice(0, 200), providerStatus,
      expiresAt: epochSeconds(now, policy.recommendationTtlSeconds)
    };
    if (proactive) {
      const committed = await deps.state.commitProactiveRecommendation({ userId, recommendation, delivery: {
        deliveryMode: 'proactive', evaluationId, recommendationId, notificationDay: chosen.guard.notificationDay,
        notificationsEnabled: preferences.notificationsEnabled, maxDailyNotifications: chosen.guard.maxDailyNotifications,
        contextFingerprint: fingerprint, triggerType: chosen.candidate.type, anchorKey: chosen.candidate.anchorKey,
        at: now.toISOString(), contextDedupSeconds: policy.contextDedupSeconds, anchorDedupSeconds: chosen.guard.anchorDedupSeconds,
        maxRecentAnchors: policy.maxRecentAnchors
      } });
      if (committed.status !== 'ok' && committed.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
      if (!committed.data.recorded) return silent('Delivery guards suppressed this recommendation.', committed.data.guardCodes, decision.usedSignals);
    } else {
      const saved = await deps.state.writeRecommendation({ userId, recommendation });
      if (saved.status !== 'ok' && saved.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
    }

    return EvaluationResultSchema.parse({
      ...base, decision: 'notify', recommendationId, triggerType: chosen.candidate.type, urgency: decision.urgency,
      message: decision.message, recommendations: items.map(item => item.api), decisionReason: decision.decisionReason,
      usedSignals: decision.usedSignals, delivery: delivery(context, previewCodes, false), providerStatus
    });
  };
}
