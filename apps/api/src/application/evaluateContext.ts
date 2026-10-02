import { EvaluationResultSchema, ProviderPlaceSchema, RecommendationDecisionSchema, UserPreferencesSchema } from '@contextia/contracts';
import type {
  ApiRecommendationItem, CandidateOpportunity, ContextInput, DeliveryDiagnostics, DemoFault, EvaluationResult, GuardCode,
  NotifyDecision, ProviderStatus, ProviderStatusMap, UserPreferences
} from '@contextia/contracts';
import type {
  ContextSnapshot, PlacesProvider, ProviderEnrichment, RecommendationModel, RecommendationSummary,
  RecommendationWrite, StateRepository, StoragePlace, StorageRecommendationItem
} from '@contextia/providers';
import type { EvaluationDomain, GuardCheckInput, GuardUserState } from './evaluationDomain.js';
import { contextFingerprint, hashCalendarId } from './fingerprint.js';
import { enrichCandidates } from './enrichCandidates.js';
import type { EnrichmentPolicy, EnrichmentProviders } from './enrichCandidates.js';
import { publicPlace, publicRoute, referenceError, suppliedRoutes } from './references.js';
import { providerCall, statusOf } from './providerCall.js';
import { claimEvaluation } from './idempotency.js';
import type { IdempotencyRepository } from './idempotency.js';
import { ApiFailure } from './apiFailure.js';
import { EvaluationDeadline } from './evaluationDeadline.js';
import { defaultDetectorPolicy, localDate, normalizeDetectorContext, weatherAt } from '@contextia/domain';
import { selectOpportunity } from './selectOpportunity.js';

export type EvaluationFailureCode = 'PROFILE_NOT_FOUND' | 'STATE_UNAVAILABLE';

/** Expected failures the handler maps to HTTP errors. Anything else is an internal error. */
export class EvaluationFailure extends Error {
  constructor(readonly code: EvaluationFailureCode) {
    super(code);
    this.name = 'EvaluationFailure';
  }
}

export interface EvaluationPolicy extends EnrichmentPolicy {
  contextTtlSeconds: number;
  recommendationTtlSeconds: number;
  contextDedupSeconds: number;
  maxRecentAnchors: number;
  nearbyRadiusMeters: number;
  nearbyMaxResults: number;
  placesTimeoutMs: number;
  modelTimeoutMs: number;
  recentRecommendationLimit: number;
  idempotencyTtlSeconds: number;
  evaluationTimeoutMs: number;
}

export const defaultEvaluationPolicy: EvaluationPolicy = Object.freeze({
  contextTtlSeconds: 24 * 60 * 60,
  recommendationTtlSeconds: 7 * 24 * 60 * 60,
  contextDedupSeconds: 300,
  maxRecentAnchors: 20,
  nearbyRadiusMeters: 1000,
  nearbyMaxResults: 30,
  placesTimeoutMs: 2500,
  weatherTimeoutMs: 2000,
  routesTimeoutMs: 3000,
  enrichmentTimeoutMs: 7000,
  maxRoutePlaces: 6,
  routeConcurrency: 4,
  eventRouteMode: 'transit',
  modelTimeoutMs: 7000,
  recentRecommendationLimit: 5,
  idempotencyTtlSeconds: 3600,
  evaluationTimeoutMs: 20000
});

export type EvaluationStateRepository = Pick<StateRepository,
  'getProfile' | 'getState' | 'writeContextSnapshot' | 'getContextSnapshot' | 'listRecommendations' | 'writeRecommendation' | 'commitProactiveRecommendation'>;

export interface EvaluationDependencies extends EnrichmentProviders {
  domain: EvaluationDomain;
  state: EvaluationStateRepository;
  places: PlacesProvider;
  model: Pick<RecommendationModel, 'decide'>;
  clock: () => Date;
  newId: (prefix: 'eval' | 'rec' | 'item') => string;
  policy?: EvaluationPolicy;
  idempotency?: IdempotencyRepository;
}

export interface EvaluateContextInput { userId: string; context: ContextInput; idempotencyKey?: string; demoFault?: DemoFault }
export type EvaluateContext = (input: EvaluateContextInput) => Promise<EvaluationResult>;

const NOT_REQUESTED: ProviderStatus = { status: 'not_requested' };

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
    ...(context.calendarStatus === undefined ? {} : { calendarStatus: context.calendarStatus }),
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

type ValidatedNotify = { decision: NotifyDecision };

/** Model output may only reference provider facts supplied for the adopted candidate. */
function validateDecision(raw: unknown, enrichment: ProviderEnrichment): { ok: true; value: ValidatedNotify | null } | { ok: false; code: string } {
  const parsed = RecommendationDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_MODEL_OUTPUT' };
  if (parsed.data.decision === 'silent') return { ok: true, value: null };
  const code = referenceError(parsed.data.recommendations, enrichment);
  if (code) return { ok: false, code };
  return { ok: true, value: { decision: parsed.data } };
}

function candidateEnrichment(candidate: CandidateOpportunity, enrichment: ProviderEnrichment): ProviderEnrichment {
  const strings = (key: string): string[] => {
    const value = candidate.facts[key];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  };
  const eligible = new Set([...strings('eligiblePlaceIds'), ...strings('unverifiedPlaceIds')]);
  const hasEligibility = Array.isArray(candidate.facts.eligiblePlaceIds);
  const eventIds = new Set([candidate.facts.eventId, candidate.facts.nextEventId, candidate.anchorKey]);
  const needs = new Set(candidate.providerNeeds);
  return {
    geocoding: needs.has('geocode-event-location') ? enrichment.geocoding.filter(entry => eventIds.has(entry.eventId)) : [],
    weather: enrichment.weather,
    places: enrichment.places.filter(entry => needs.has(entry.need) && (entry.anchorKey === 'current' || eventIds.has(entry.anchorKey)))
      .map(entry => ({ ...entry, result: entry.result.data ? { ...entry.result, data: entry.result.data.filter(place => !hasEligibility || eligible.has(place.placeId)) } : entry.result })),
    routes: enrichment.routes.filter(entry => needs.has(entry.need) && (entry.need === 'route-to-next-event' ? eventIds.has(entry.anchorKey) : eligible.has(entry.anchorKey)))
  };
}

export function createEvaluateContext(deps: EvaluationDependencies): EvaluateContext {
  const policy = deps.policy ?? defaultEvaluationPolicy;
  for (const [key, value] of Object.entries(policy)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)) throw new RangeError(`Invalid evaluation policy: ${key}`);
  }
  if (policy.nearbyMaxResults > 30 || policy.maxRoutePlaces > 30 || policy.routeConcurrency > 8) throw new RangeError('Provider fan-out exceeds supported bounds');
  if (policy.evaluationTimeoutMs > 20000) throw new RangeError('Evaluation budget must leave time before the Lambda timeout');
  if (policy.contextTtlSeconds <= policy.contextDedupSeconds) {
    throw new RangeError('contextTtlSeconds must exceed contextDedupSeconds so an expired snapshot is never a recent duplicate');
  }

  return async ({ userId, context, idempotencyKey, demoFault }) => {
    // One request-start instant keeps both guard passes on the same day and window.
    const now = deps.clock();
    const nowEpochSeconds = epochSeconds(now);
    const deadline = new EvaluationDeadline(policy.evaluationTimeoutMs);
    let pendingClaim: Awaited<ReturnType<typeof claimEvaluation>> | undefined;
    let durableWriteStarted = false;
    let finish: (result: EvaluationResult, places?: StoragePlace[]) => Promise<EvaluationResult> = result => deadline.run(async () => result);
    try {
      if (idempotencyKey) {
        const idempotency = deps.idempotency;
        if (!idempotency) throw new ApiFailure('STATE_UNAVAILABLE');
        const claim = await deadline.run(() => claimEvaluation({ state: idempotency, userId, context, key: idempotencyKey, now, ttlSeconds: policy.idempotencyTtlSeconds,
          ...(demoFault ? { demoFault } : {}) }));
        if ('replay' in claim) return claim.replay;
        pendingClaim = claim;
        finish = (result, places = []) => {
          durableWriteStarted = true;
          return deadline.run(() => claim.complete(result, places));
        };
      }
      const evaluationId = deps.newId('eval');
      const contextExpiresAt = epochSeconds(now, policy.contextTtlSeconds);

      const profile = await deadline.run(() => deps.state.getProfile({ userId }));
      if (profile.status !== 'ok' && profile.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
      if (!profile.data) throw new EvaluationFailure('PROFILE_NOT_FOUND');
      if (profile.data.userId !== userId) throw new EvaluationFailure('STATE_UNAVAILABLE');
      const preferences = effectivePreferences(profile.data.preferences, context);

      const stateResult = await deadline.run(() => deps.state.getState({ userId, nowEpochSeconds }));
      if (stateResult.status !== 'ok' && stateResult.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
      const fingerprint = contextFingerprint(context);
      const state = await deadline.run(() => resolveGuardState(deps.state, userId, nowEpochSeconds, stateResult.data, fingerprint));
      const guardBase: GuardCheckInput = { now, deliveryMode: context.deliveryMode, preferences, state, contextFingerprint: fingerprint };
      const pre = deps.domain.checkDeliveryGuards(guardBase);

      // Prior state was read above; record this context (including preview) before any provider work.
      durableWriteStarted = true;
      const written = await deadline.run(() => deps.state.writeContextSnapshot({
        userId, snapshot: snapshotOf(context, evaluationId, now, contextExpiresAt), fingerprint,
        processedAt: now.toISOString(), notificationDay: pre.notificationDay
      }));
      if (written.status !== 'ok' && written.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');

      const providerStatus: ProviderStatusMap = {
        geocoding: NOT_REQUESTED, places: NOT_REQUESTED, weather: NOT_REQUESTED, routes: NOT_REQUESTED, bedrock: NOT_REQUESTED
      };
      const normalized = normalizeDetectorContext({ context, preferences, clock: { now: () => now }, profileTimezone: preferences.timezone });
      const base: Pick<EvaluationResult, 'evaluationId' | 'contextExpiresAt' | 'normalizedContext' | 'weather'> = {
        evaluationId, contextExpiresAt: new Date(contextExpiresAt * 1000).toISOString(), weather: null,
        ...(normalized.mode === 'simulation' ? { normalizedContext: {
          mode: 'simulation', evaluationAt: normalized.evaluationAt.toISOString(), timezone: normalized.timezone, stepGoal: normalized.stepGoal,
          location: normalized.location, ...(normalized.activity ? { activity: normalized.activity } : {}),
          calendar: [...normalized.calendar], ...(context.calendarStatus === undefined ? {} : { calendarStatus: context.calendarStatus }), preferences: normalized.preferences
        } } : {})
      };
      const silent = (decisionReason: string, guardCodes: GuardCode[], usedSignals: EvaluationResult['usedSignals'] = []): EvaluationResult =>
        EvaluationResultSchema.parse({
          ...base, decision: 'silent', recommendationId: null, triggerType: null, urgency: null, message: null, recommendations: [],
          decisionReason, usedSignals, delivery: delivery(context, guardCodes, true), providerStatus
        });

      if (!pre.shouldEvaluate) return finish(silent('Delivery guards suppressed this evaluation.', pre.guardCodes));

      const candidates = await deadline.run(() => deps.domain.detectCandidates({ context, preferences, now }));
      if (candidates.length === 0) return finish(silent('No candidate opportunity was detected.', [...pre.guardCodes, 'NO_CANDIDATE']));

      const checked = candidates.map(candidate => ({
        candidate, guard: deps.domain.checkDeliveryGuards({ ...guardBase, opportunity: { type: candidate.type, anchorKey: candidate.anchorKey } })
      }));
      const viable = checked.filter(entry => entry.guard.shouldEvaluate);
      const candidateGuardCodes = checked.flatMap(entry => entry.guard.guardCodes);
      if (viable.length === 0) return finish(silent('Delivery guards suppressed every candidate.', [...pre.guardCodes, ...candidateGuardCodes]));
      // Preview keeps every candidate and reports what proactive delivery would have suppressed.
      const previewCodes: GuardCode[] = context.deliveryMode === 'preview' ? [...pre.guardCodes, ...candidateGuardCodes] : [];

      const evaluationAt = context.mode === 'simulation' ? new Date(context.scenarioTime ?? context.capturedAt) : now;
      // Request-local decorators leave warm Lambda providers unchanged; unneeded providers remain unrequested.
      const providers: EnrichmentProviders = { ...deps,
        ...(demoFault === 'weather' ? { weather: { getWeather: async () => ({ status: 'unavailable' as const, data: null, code: 'DEMO_FORCED_UNAVAILABLE' }) } } : {}),
        ...(demoFault === 'routes' ? { routes: { getRoute: async () => ({ status: 'unavailable' as const, data: null, code: 'DEMO_FORCED_UNAVAILABLE' }) } } : {})
      };
      const enriched = await deadline.run(() => enrichCandidates({ context, evaluationAt, preferences, candidates: viable.map(entry => entry.candidate), providers, policy }));
      Object.assign(providerStatus, enriched.providerStatus);
      base.weather = weatherAt(enriched.enrichment, evaluationAt.getTime(), defaultDetectorPolicy, context.mode);
      const refined = deps.domain.refineCandidates({ context, preferences, now, candidates: viable.map(entry => entry.candidate), evidence: enriched.enrichment });
      if (!refined.length) return finish(silent('Provider facts did not justify a meaningful opportunity.', [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY']));
      const candidate = selectOpportunity(refined);
      if (!candidate) throw new EvaluationFailure('STATE_UNAVAILABLE');
      const original = viable.find(entry => entry.candidate.type === candidate.type && entry.candidate.anchorKey === candidate.anchorKey);
      if (!original) throw new EvaluationFailure('STATE_UNAVAILABLE');
      const chosen = { candidate, guard: original.guard };
      const enrichment = candidateEnrichment(candidate, enriched.enrichment);

      const recent = await deadline.run(() => deps.state.listRecommendations({ userId, nowEpochSeconds, limit: policy.recentRecommendationLimit }));
      if (recent.status !== 'ok' && recent.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
      const recentRecommendations: RecommendationSummary[] = (recent.data?.items ?? []).map(item => ({
        recommendationId: item.id, triggerType: item.triggerType, createdAt: item.createdAt, summary: item.summaryForDedup
      }));

      const decided = await deadline.run(() => providerCall(() => deps.model.decide({
        context, now: evaluationAt.toISOString(), preferences, candidates: [candidate], enrichment, recentRecommendations
      }), policy.modelTimeoutMs));
      if (decided.status !== 'ok' && decided.status !== 'degraded') {
        providerStatus.bedrock = statusOf(decided);
        return finish(silent('The recommendation model was unavailable.', [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY']));
      }
      const validated = validateDecision(decided.data, enrichment);
      if (!validated.ok) {
        providerStatus.bedrock = { ...statusOf(decided), status: 'error', code: validated.code };
        return finish(silent('The recommendation model returned an unusable decision.', [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY']));
      }
      providerStatus.bedrock = statusOf(decided);
      if (!validated.value) {
        return finish(silent(decided.data.decisionReason, [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY'], decided.data.usedSignals));
      }
      const { decision } = validated.value;

      const recommendationId = deps.newId('rec');
      const proactive = context.deliveryMode === 'proactive';

      const storagePlaces = new Map<string, StoragePlace>();
      const selectedIds = [...new Set(decision.recommendations.flatMap(item => item.place ? [item.place.placeId] : []))];
      let storageFailed = false;
      await deadline.run(() => Promise.all(selectedIds.map(async placeId => {
        const stored = await providerCall(() => deps.places.getPlace({ placeId, locale: preferences.locale, persistenceIntent: 'storage' }), policy.placesTimeoutMs);
        const parsed = stored.data ? ProviderPlaceSchema.safeParse(stored.data.place) : null;
        if ((stored.status !== 'ok' && stored.status !== 'degraded') || !stored.data || stored.data.persistenceIntent !== 'storage' || !parsed?.success || parsed.data.placeId !== placeId) {
          storageFailed = true;
          return;
        }
        storagePlaces.set(placeId, { persistenceIntent: 'storage', place: parsed.data });
      })));
      if (storageFailed) {
        providerStatus.places = { status: 'degraded', code: 'PLACE_STORAGE_UNAVAILABLE' };
        return finish(silent('Selected places could not be stored safely.', [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY']));
      }
      if (decision.recommendations.some(item => item.action.type === 'WEBSITE' && storagePlaces.get(item.place?.placeId ?? '')?.place.websiteUrl !== item.action.url)) {
        providerStatus.places = { status: 'degraded', code: 'PLACE_STORAGE_UNAVAILABLE' };
        return finish(silent('Selected website could not be stored safely.', [...previewCodes, 'NO_MEANINGFUL_OPPORTUNITY']));
      }
      const routes = suppliedRoutes(enrichment);
      const items = decision.recommendations.map(item => {
        const id = deps.newId('item');
        const storagePlace = item.place ? storagePlaces.get(item.place.placeId) ?? null : null;
        const place = storagePlace ? publicPlace(storagePlace.place) : null;
        const sourceRoute = item.route ? routes.find(route => route.mode === item.route?.mode && route.durationMinutes === item.route.durationMinutes
          && (item.route.departAt === undefined || item.route.departAt === route.departAt)
          && (item.route.arriveAt === undefined || item.route.arriveAt === route.arriveAt)
          && (item.route.transfers === undefined || item.route.transfers === route.transfers)) : undefined;
        const api: ApiRecommendationItem = { id, title: item.title, reason: item.reason, place, route: sourceRoute ? publicRoute(sourceRoute) : null, action: item.action };
        const storage: StorageRecommendationItem = { ...api, place: storagePlace };
        return { api, storage };
      });

      const createdAt = now.toISOString();
      const recommendation: RecommendationWrite = {
        id: recommendationId, evaluationId, contextReference: { evaluationId, capturedAt: context.capturedAt }, createdAt,
        triggerType: chosen.candidate.type, urgency: decision.urgency, message: decision.message,
        recommendations: items.map(item => item.storage), usedSignals: decision.usedSignals,
        summaryForDedup: decision.message.slice(0, 200), providerStatus,
        expiresAt: epochSeconds(now, policy.recommendationTtlSeconds)
      };
      if (proactive) {
        // Timestamp pruning must have room for all active/future anchors so today's goal cannot be evicted.
        const active = state?.recentAnchors.filter(anchor => Date.parse(anchor.notifiedAt) > now.getTime()
          || localDate(new Date(anchor.notifiedAt), chosen.guard.timezone) === chosen.guard.notificationDay) ?? [];
        const activeKeys = new Set([...active.map(anchor => `${anchor.triggerType}#${anchor.anchorKey}`), `${candidate.type}#${candidate.anchorKey}`]);
        if (activeKeys.size > policy.maxRecentAnchors || policy.maxRecentAnchors < chosen.guard.maxDailyNotifications) throw new EvaluationFailure('STATE_UNAVAILABLE');
        const committed = await deadline.run(() => deps.state.commitProactiveRecommendation({ userId, recommendation, delivery: {
          deliveryMode: 'proactive', evaluationId, recommendationId, notificationDay: chosen.guard.notificationDay,
          notificationsEnabled: preferences.notificationsEnabled, notificationFrequency: preferences.notificationFrequency,
          maxDailyNotifications: chosen.guard.maxDailyNotifications,
          contextFingerprint: fingerprint, triggerType: chosen.candidate.type, anchorKey: chosen.candidate.anchorKey,
          at: now.toISOString(), contextDedupSeconds: policy.contextDedupSeconds, anchorDedupSeconds: chosen.guard.anchorDedupSeconds,
          maxRecentAnchors: policy.maxRecentAnchors
        } }));
        if (committed.status !== 'ok' && committed.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
        if (!committed.data.recorded) {
          if (committed.data.reason === 'superseded') {
            // The transaction is known not to have committed; do not invite a transient-error retry.
            durableWriteStarted = false;
            throw new ApiFailure('EVALUATION_SUPERSEDED');
          }
          if (!committed.data.guardCodes.length) throw new EvaluationFailure('STATE_UNAVAILABLE');
          return finish(silent('Delivery guards suppressed this recommendation.', committed.data.guardCodes, decision.usedSignals));
        }
      } else {
        const saved = await deadline.run(() => deps.state.writeRecommendation({ userId, recommendation }));
        if (saved.status !== 'ok' && saved.status !== 'degraded') throw new EvaluationFailure('STATE_UNAVAILABLE');
      }

      return finish(EvaluationResultSchema.parse({
        ...base, decision: 'notify', recommendationId, triggerType: chosen.candidate.type, urgency: decision.urgency,
        message: decision.message, recommendations: items.map(item => item.api), decisionReason: decision.decisionReason,
        usedSignals: decision.usedSignals, delivery: delivery(context, previewCodes, false), providerStatus
      }), [...storagePlaces.values()]);
    } catch (error: unknown) {
      const claim = pendingClaim;
      if (claim && !('replay' in claim) && !durableWriteStarted) {
        // A timed-out/failed write may have committed. Only release before any write,
        // or after an explicit atomic rejection. CAS protects a replacement claim.
        try { await new EvaluationDeadline(2000).run(() => claim.release()); }
        catch { /* Preserve the original safe failure; an uncertain claim stays reserved. */ }
      }
      throw error;
    }
  };
}
