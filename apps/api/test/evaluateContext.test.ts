import { describe, expect, it, vi } from 'vitest';
import { EvaluationResultSchema } from '@contextia/contracts';
import type { CandidateOpportunity, ContextInput, NotifyDecision, ProviderPlace, ProviderResult, RecommendationDecision } from '@contextia/contracts';
import type { ContextSnapshot, DeliveryGuardCode, PlacesProvider, RecommendationModelInput, UserState } from '@contextia/providers';
import { getScenarioInput, scenarios } from '@contextia/test-fixtures';
import { EvaluationFailure, createEvaluateContext, defaultEvaluationPolicy } from '../src/application/evaluateContext.js';
import type { EvaluationDependencies, EvaluationStateRepository } from '../src/application/evaluateContext.js';
import type { EvaluationDomain, GuardCheckInput } from '../src/application/evaluationDomain.js';
import { contextFingerprint } from '../src/application/fingerprint.js';

const NOW = new Date('2026-10-01T05:10:00.000Z');
const fixture = scenarios.find(value => value.id === 'step-goal');
if (!fixture) throw new Error('step-goal fixture missing');
const preferences = fixture.preferences;
const cafe: ProviderPlace = (() => {
  const place = fixture.providers.places.data?.[0];
  if (!place) throw new Error('step-goal fixture has no place');
  return place;
})();
const preview: ContextInput = getScenarioInput('step-goal');
const proactive: ContextInput = { ...preview, mode: 'real', deliveryMode: 'proactive', location: { ...preview.location, source: 'gps' } };
const candidate: CandidateOpportunity = {
  type: 'STEP_GOAL_REST', confidence: 1, anchorKey: '2026-10-01', requiredSignals: ['steps', 'location', 'time'],
  providerNeeds: ['places-near-current'], facts: { stepsToday: 10_432, stepGoal: 10_000 }
};
const cafePlace = { provider: cafe.provider, placeId: cafe.placeId, name: cafe.name, latitude: cafe.latitude, longitude: cafe.longitude, distanceMeters: cafe.distanceMeters };
const notify: NotifyDecision = {
  decision: 'notify', decisionReason: 'Goal reached near a quiet cafe.', usedSignals: ['steps', 'location', 'places'], urgency: 'low',
  message: '目標達成です。近くで一息つきませんか。',
  recommendations: [{ title: cafe.name, reason: '徒歩圏内です。', place: { ...cafePlace, name: 'model-invented name' }, action: { type: 'MAP' } }]
};

type Options = {
  guardCodes?: DeliveryGuardCode[];
  candidateGuardCodes?: DeliveryGuardCode[];
  candidates?: CandidateOpportunity[];
  places?: ProviderResult<ProviderPlace[]>;
  decision?: () => Promise<ProviderResult<RecommendationDecision>>;
  recorded?: boolean;
  profile?: 'missing' | 'error';
  userState?: UserState | null;
  snapshot?: ProviderResult<ContextSnapshot | null>;
  // Back getState/getContextSnapshot with what writeContextSnapshot stored, like the real repository.
  memory?: boolean;
  clock?: () => Date;
};

const baseState: UserState = { notificationDay: '2026-10-01', notificationsSentToday: 0, recentAnchors: [] };

function setup(options: Options = {}) {
  const guardCalls: GuardCheckInput[] = [];
  let stored: Parameters<EvaluationStateRepository['writeContextSnapshot']>[0] | undefined;
  const domain: EvaluationDomain = {
    checkDeliveryGuards(input) {
      guardCalls.push(input);
      const guardCodes = [...(options.guardCodes ?? []), ...(input.opportunity ? options.candidateGuardCodes ?? [] : [])];
      return { shouldEvaluate: input.deliveryMode === 'preview' || guardCodes.length === 0, guardCodes, notificationDay: '2026-10-01', maxDailyNotifications: 3 };
    },
    detectCandidates: () => Promise.resolve(options.candidates ?? [candidate])
  };
  const state = {
    getProfile: vi.fn<EvaluationStateRepository['getProfile']>(() => Promise.resolve(
      options.profile === 'error' ? { status: 'error', data: null }
        : { status: 'ok', data: options.profile === 'missing' ? null : { userId: 'user-1', preferences } })),
    getState: vi.fn<EvaluationStateRepository['getState']>(() => Promise.resolve({ status: 'ok', data: stored ? {
      ...baseState, latestContext: { evaluationId: stored.snapshot.evaluationId, capturedAt: stored.snapshot.capturedAt }, latestContextFingerprint: stored.fingerprint
    } : options.userState ?? null })),
    writeContextSnapshot: vi.fn<EvaluationStateRepository['writeContextSnapshot']>(input => {
      if (options.memory) stored = input;
      return Promise.resolve({ status: 'ok', data: null });
    }),
    getContextSnapshot: vi.fn<EvaluationStateRepository['getContextSnapshot']>(() => Promise.resolve(
      stored ? { status: 'ok', data: stored.snapshot } : options.snapshot ?? { status: 'ok', data: null })),
    listRecommendations: vi.fn<EvaluationStateRepository['listRecommendations']>(() => Promise.resolve({ status: 'ok', data: { items: [], nextCursor: null } })),
    writeRecommendation: vi.fn<EvaluationStateRepository['writeRecommendation']>(() => Promise.resolve({ status: 'ok', data: null })),
    recordProactiveDelivery: vi.fn<EvaluationStateRepository['recordProactiveDelivery']>(() => Promise.resolve(
      options.recorded === false ? { status: 'ok', data: { recorded: false, guardCodes: ['DAILY_CAP_REACHED'] } } : { status: 'ok', data: { recorded: true } }))
  } satisfies EvaluationStateRepository;
  const places = {
    searchNearby: vi.fn<PlacesProvider['searchNearby']>(() => Promise.resolve<ProviderResult<ProviderPlace[]>>(options.places ?? { status: 'ok', data: [cafe], latencyMs: 40 })),
    getPlace: vi.fn((input: { placeId: string; persistenceIntent: 'storage' | 'single-use' }) => Promise.resolve({
      status: 'ok' as const, data: { persistenceIntent: input.persistenceIntent, place: { ...cafe, name: 'Storage name' } }
    }))
  };
  const decide = vi.fn((input: RecommendationModelInput) => {
    void input;
    return options.decision ? options.decision() : Promise.resolve<ProviderResult<RecommendationDecision>>({ status: 'ok', data: notify, latencyMs: 900 });
  });
  let sequence = 0;
  const deps: EvaluationDependencies = {
    domain, state, places: places as unknown as PlacesProvider, model: { decide },
    clock: options.clock ?? (() => NOW), newId: prefix => `${prefix}-${++sequence}`
  };
  return { evaluate: createEvaluateContext(deps), state, places, decide, guardCalls };
}

describe('createEvaluateContext', () => {
  it('runs guards, detection, Places and the model, then returns a schema-valid preview notify', async () => {
    const { evaluate, places, decide, state, guardCalls } = setup();
    const result = await evaluate({ userId: 'user-1', context: preview });
    expect(EvaluationResultSchema.parse(result)).toMatchObject({
      decision: 'notify', triggerType: 'STEP_GOAL_REST', recommendationId: 'rec-2',
      delivery: { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: [] },
      providerStatus: { places: { status: 'ok', latencyMs: 40 }, bedrock: { status: 'ok' }, weather: { status: 'not_requested' } },
      contextExpiresAt: '2026-10-02T05:10:00.000Z'
    });
    expect(places.searchNearby).toHaveBeenCalledWith(expect.objectContaining({ persistenceIntent: 'single-use' }));
    expect(decide.mock.calls[0]?.[0].candidates).toEqual([candidate]);
    expect(guardCalls.map(call => call.opportunity)).toEqual([undefined, { type: 'STEP_GOAL_REST', anchorKey: '2026-10-01' }]);
    expect(guardCalls.every(call => call.now === NOW)).toBe(true);
    // Preview never consumes delivery quota.
    expect(state.recordProactiveDelivery).not.toHaveBeenCalled();
  });

  it('shows provider place data, never model-invented fields, and persists only the Storage lookup', async () => {
    const { evaluate, places, state } = setup();
    const result = await evaluate({ userId: 'user-1', context: preview });
    expect(result.recommendations[0]?.place).toEqual(cafePlace);
    expect(places.getPlace).toHaveBeenCalledWith(expect.objectContaining({ placeId: cafe.placeId, persistenceIntent: 'storage' }));
    const stored = state.writeRecommendation.mock.calls[0]?.[0].recommendation;
    expect(stored?.recommendations[0]?.place).toMatchObject({ persistenceIntent: 'storage', place: { name: 'Storage name' } });
    expect(stored?.expiresAt).toBe(NOW.getTime() / 1000 + 7 * 24 * 60 * 60);
  });

  it('applies scenario preference overrides only in simulation', async () => {
    const { evaluate, guardCalls } = setup();
    await evaluate({ userId: 'user-1', context: { ...preview, preferencesOverride: { notificationsEnabled: false } } });
    expect(guardCalls[0]?.preferences.notificationsEnabled).toBe(false);
    const real = setup();
    await real.evaluate({ userId: 'user-1', context: { ...proactive, preferencesOverride: { notificationsEnabled: false } } });
    expect(real.guardCalls[0]?.preferences.notificationsEnabled).toBe(preferences.notificationsEnabled);
  });

  it('records the context snapshot with hashed calendar IDs before provider work', async () => {
    const { evaluate, state } = setup();
    const context = { ...preview, calendar: [{ id: 'device-event-1', title: 'Meeting', startAt: preview.capturedAt, endAt: preview.capturedAt }] };
    await evaluate({ userId: 'user-1', context });
    const write = state.writeContextSnapshot.mock.calls[0]?.[0];
    expect(write?.snapshot.calendar[0]?.id).not.toBe('device-event-1');
    expect(write?.snapshot.expiresAt).toBe(NOW.getTime() / 1000 + 24 * 60 * 60);
    expect(write?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps preview results visible while reporting what proactive delivery would suppress', async () => {
    const { evaluate, decide } = setup({ guardCodes: ['DUPLICATE_CONTEXT'], candidateGuardCodes: ['RECENT_SAME_TRIGGER'] });
    const result = await evaluate({ userId: 'user-1', context: preview });
    expect(result).toMatchObject({ decision: 'notify', delivery: { mode: 'preview', wouldSuppress: true, guardCodes: ['DUPLICATE_CONTEXT', 'RECENT_SAME_TRIGGER'] } });
    expect(decide).toHaveBeenCalledOnce();
  });

  it('suppresses guarded proactive evaluations before detection, Places or Bedrock', async () => {
    const { evaluate, places, decide } = setup({ guardCodes: ['DAILY_CAP_REACHED'] });
    const result = await evaluate({ userId: 'user-1', context: proactive });
    expect(result).toMatchObject({ decision: 'silent', delivery: { mode: 'proactive', status: 'suppressed', guardCodes: ['DAILY_CAP_REACHED'] } });
    expect(Object.values(result.providerStatus).every(status => status.status === 'not_requested')).toBe(true);
    expect(places.searchNearby).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('drops proactive candidates whose trigger anchor is guarded', async () => {
    const { evaluate, decide } = setup({ candidateGuardCodes: ['RECENT_SAME_TRIGGER'] });
    const result = await evaluate({ userId: 'user-1', context: proactive });
    expect(result).toMatchObject({ decision: 'silent', delivery: { status: 'suppressed', guardCodes: ['RECENT_SAME_TRIGGER'] } });
    expect(decide).not.toHaveBeenCalled();
  });

  it('returns silent NO_CANDIDATE without calling providers', async () => {
    const { evaluate, places, decide } = setup({ candidates: [] });
    const result = await evaluate({ userId: 'user-1', context: proactive });
    expect(result).toMatchObject({ decision: 'silent', delivery: { status: 'suppressed', guardCodes: ['NO_CANDIDATE'] } });
    expect(places.searchNearby).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('records proactive delivery atomically before storing the recommendation', async () => {
    const { evaluate, state } = setup();
    const result = await evaluate({ userId: 'user-1', context: proactive });
    expect(result).toMatchObject({ decision: 'notify', delivery: { mode: 'proactive', status: 'ready', wouldSuppress: false } });
    expect(state.recordProactiveDelivery).toHaveBeenCalledWith({ userId: 'user-1', delivery: expect.objectContaining({
      deliveryMode: 'proactive', recommendationId: 'rec-2', notificationDay: '2026-10-01', maxDailyNotifications: 3,
      triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', contextDedupSeconds: 300, anchorDedupSeconds: 1800
    }) });
    const [delivery] = state.recordProactiveDelivery.mock.invocationCallOrder;
    const [write] = state.writeRecommendation.mock.invocationCallOrder;
    expect(delivery).toBeLessThan(write ?? 0);
  });

  it('returns silent when the atomic delivery recheck rejects, without storing a recommendation', async () => {
    const { evaluate, state } = setup({ recorded: false });
    const result = await evaluate({ userId: 'user-1', context: proactive });
    expect(result).toMatchObject({ decision: 'silent', delivery: { status: 'suppressed', guardCodes: ['DAILY_CAP_REACHED'] } });
    expect(state.writeRecommendation).not.toHaveBeenCalled();
  });

  it('still asks the model when Places is unavailable, reporting the degradation', async () => {
    const { evaluate, decide } = setup({ places: { status: 'unavailable', data: null, code: 'NO_COVERAGE' }, decision: () => Promise.resolve({ status: 'ok', data: {
      decision: 'silent', decisionReason: 'Nothing useful nearby.', usedSignals: ['steps'], urgency: null, message: null, recommendations: []
    } }) });
    const result = await evaluate({ userId: 'user-1', context: preview });
    expect(decide).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ decision: 'silent', providerStatus: { places: { status: 'unavailable', code: 'NO_COVERAGE' } }, delivery: { guardCodes: ['NO_MEANINGFUL_OPPORTUNITY'] } });
  });

  it('rejects model output that references places it was not given', async () => {
    const invented = { ...notify, recommendations: [{ ...notify.recommendations[0], place: { ...cafePlace, placeId: 'invented' } }] };
    const { evaluate, state } = setup({ decision: () => Promise.resolve({ status: 'ok', data: invented as RecommendationDecision }) });
    const result = await evaluate({ userId: 'user-1', context: preview });
    expect(result).toMatchObject({ decision: 'silent', providerStatus: { bedrock: { status: 'error', code: 'UNKNOWN_PLACE_REFERENCE' } } });
    expect(state.writeRecommendation).not.toHaveBeenCalled();
  });

  it('rejects routes because none are supplied in Phase 1', async () => {
    const withRoute = { ...notify, recommendations: [{ ...notify.recommendations[0], route: { mode: 'transit', durationMinutes: 12 } }] };
    const { evaluate } = setup({ decision: () => Promise.resolve({ status: 'ok', data: withRoute as RecommendationDecision }) });
    expect((await evaluate({ userId: 'user-1', context: preview })).providerStatus.bedrock).toMatchObject({ status: 'error', code: 'UNKNOWN_ROUTE_REFERENCE' });
  });

  it('times out a slow model instead of hanging the request', async () => {
    vi.useFakeTimers();
    try {
      const { evaluate } = setup({ decision: () => new Promise(() => undefined) });
      const pending = evaluate({ userId: 'user-1', context: preview });
      await vi.advanceTimersByTimeAsync(7000);
      expect(await pending).toMatchObject({ decision: 'silent', providerStatus: { bedrock: { status: 'timeout' } } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports unconnected provider needs instead of fabricating them', async () => {
    const { evaluate } = setup({ candidates: [{ ...candidate, providerNeeds: ['places-near-current', 'weather-current', 'route-to-next-event'] }] });
    const result = await evaluate({ userId: 'user-1', context: preview });
    expect(result.providerStatus).toMatchObject({ weather: { status: 'unavailable', code: 'PROVIDER_NOT_CONNECTED' }, routes: { status: 'unavailable' } });
  });

  it('fails with typed errors when the profile is missing or state is unavailable', async () => {
    await expect(setup({ profile: 'missing' }).evaluate({ userId: 'user-1', context: preview })).rejects.toEqual(new EvaluationFailure('PROFILE_NOT_FOUND'));
    await expect(setup({ profile: 'error' }).evaluate({ userId: 'user-1', context: preview })).rejects.toEqual(new EvaluationFailure('STATE_UNAVAILABLE'));
  });
});

describe('server processing time for duplicate-context guards (Issue #5)', () => {
  const fingerprint = contextFingerprint(preview);
  const reference = { evaluationId: 'eval-earlier', capturedAt: preview.capturedAt };
  const matching: UserState = { ...baseState, latestContext: reference, latestContextFingerprint: fingerprint };
  const snapshotAt = (createdAt: string): ContextSnapshot => ({
    ...reference, mode: preview.mode, location: { latitude: preview.location.latitude, longitude: preview.location.longitude },
    calendar: [], createdAt, expiresAt: NOW.getTime() / 1000 + 3600
  });

  it('passes the stored snapshot server time, not capturedAt, when the fingerprint matches', async () => {
    const { evaluate, state, guardCalls } = setup({ userState: matching, snapshot: { status: 'ok', data: snapshotAt('2026-10-01T05:08:00.000Z') } });
    await evaluate({ userId: 'user-1', context: preview });
    expect(state.getContextSnapshot).toHaveBeenCalledWith({ userId: 'user-1', nowEpochSeconds: NOW.getTime() / 1000, reference });
    expect(guardCalls.map(call => call.latestContextProcessedAt)).toEqual(['2026-10-01T05:08:00.000Z', '2026-10-01T05:08:00.000Z']);
    expect(guardCalls[0]?.state?.latestContextFingerprint).toBe(fingerprint);
  });

  it('skips the snapshot read when the fingerprint differs or there is no state', async () => {
    for (const userState of [{ ...matching, latestContextFingerprint: 'other' }, null]) {
      const { evaluate, state, guardCalls } = setup({ userState });
      await evaluate({ userId: 'user-1', context: preview });
      expect(state.getContextSnapshot).not.toHaveBeenCalled();
      expect(guardCalls[0]).not.toHaveProperty('latestContextProcessedAt');
    }
  });

  it('drops a fingerprint whose snapshot has expired, since the TTL outlasts the dedup window', async () => {
    const { evaluate, guardCalls } = setup({ userState: matching, snapshot: { status: 'ok', data: null } });
    await evaluate({ userId: 'user-1', context: preview });
    expect(guardCalls[0]?.state).toEqual({ ...baseState, latestContext: reference });
    expect(guardCalls[0]).not.toHaveProperty('latestContextProcessedAt');
  });

  it('fails closed before writing when the processing time cannot be read', async () => {
    for (const options of [
      { userState: matching, snapshot: { status: 'error', data: null } },
      { userState: { ...baseState, latestContextFingerprint: fingerprint } }
    ] satisfies Options[]) {
      const { evaluate, state } = setup(options);
      await expect(evaluate({ userId: 'user-1', context: preview })).rejects.toEqual(new EvaluationFailure('STATE_UNAVAILABLE'));
      expect(state.writeContextSnapshot).not.toHaveBeenCalled();
    }
  });

  it('re-running a preview with a past scenario time sees the first run\'s server time', async () => {
    let now = NOW;
    const past = { ...preview, capturedAt: '2026-09-30T23:00:00.000Z', scenarioTime: '2026-09-30T23:00:00.000Z' };
    const { evaluate, guardCalls } = setup({ memory: true, clock: () => now });
    await evaluate({ userId: 'user-1', context: past });
    now = new Date(NOW.getTime() + 60_000);
    await evaluate({ userId: 'user-1', context: past });
    const second = guardCalls.find(call => call.now === now);
    expect(second?.latestContextProcessedAt).toBe(NOW.toISOString());
    expect(second?.state?.latestContextFingerprint).toBe(contextFingerprint(past));
  });

  it('rejects a policy whose snapshot TTL does not outlast the dedup window', () => {
    const deps = { policy: { ...defaultEvaluationPolicy, contextTtlSeconds: 300 } } as unknown as EvaluationDependencies;
    expect(() => createEvaluateContext(deps)).toThrow(RangeError);
  });
});
