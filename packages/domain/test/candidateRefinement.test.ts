import { describe, expect, it } from 'vitest';
import {
  ActivityContextSchema, CandidateOpportunitySchema, ContextInputSchema, DetectorPolicySchema,
  ProviderPlaceSchema, RecommendationDecisionSchema, SignalNameSchema, TriggerTypeSchema
} from '@contextia/contracts';
import {
  freeTime, getScenarioEvidence, scenarios, stepGoal, upcomingTransit, weatherAdaptation
} from '@contextia/test-fixtures';
import {
  createDetectorRegistry, defaultDetectorPolicy, detectCandidates, distanceMeters, evaluateDeliveryGuards,
  filterCandidatesBySignals, normalizeDetectorContext, phase2Detectors, refineCandidates
} from '../src/index.js';
import { normalized, primaryCandidates, refined } from './detectorHarness.js';

describe('Phase 2 candidate orchestration', () => {
  it('publishes all five detectors without limiting preliminary opportunities to three', async () => {
    expect(phase2Detectors.map(detector => detector.type).sort()).toEqual([...TriggerTypeSchema.options].sort());
    const context = normalized(stepGoal, { calendar: upcomingTransit.context.calendar });
    const candidates = await detectCandidates(context);
    expect(candidates).toHaveLength(5);
    expect(new Set(candidates.map(candidate => candidate.type)).size).toBe(5);
  });

  it.each(scenarios)('validates $id detection, needs, evidence and the three-card contract', async fixture => {
    const seeds = await primaryCandidates(fixture);
    expect(seeds[0]?.type).toBe(fixture.primaryTrigger);
    expect(seeds[0]?.providerNeeds).toEqual(fixture.providerNeeds);
    const result = await refined(fixture);
    expect(result.candidates).toHaveLength(1);
    const candidate = CandidateOpportunitySchema.parse(result.candidates[0]);
    expect(candidate.type).toBe(fixture.primaryTrigger);
    for (const signal of candidate.requiredSignals) expect(SignalNameSchema.safeParse(signal).success).toBe(true);
    // Assert structure, never exact AI prose or a fixed model answer in the fixture.
    const card = { title: 'Test option', reason: 'Test reason', action: { type: 'NONE' } };
    const decision = {
      decision: 'notify', decisionReason: 'Test decision', urgency: 'low', message: 'Test message',
      usedSignals: candidate.requiredSignals, recommendations: [card, card, card]
    };
    expect(RecommendationDecisionSchema.safeParse(decision).success).toBe(true);
    expect(RecommendationDecisionSchema.safeParse({ ...decision, recommendations: [...decision.recommendations, card] }).success).toBe(false);
  });

  it('excludes unavailable transit while preserving the independent step goal', async () => {
    const context = normalized(upcomingTransit, { activity: ActivityContextSchema.parse(stepGoal.context.activity) });
    const candidates = await detectCandidates(context);
    const evidence = getScenarioEvidence(upcomingTransit);
    const cafe = ProviderPlaceSchema.parse(stepGoal.providers.places.data?.[0]);
    evidence.places = [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'ok', data: [{
      ...cafe, latitude: context.location.latitude + 0.0001, longitude: context.location.longitude, distanceMeters: 12
    }] } }];
    evidence.routes = evidence.routes.map(entry => ({ ...entry, result: { status: 'unavailable', data: null } }));
    const before = structuredClone({ candidates, evidence });
    const result = refineCandidates({ context, candidates, evidence });
    expect(result.candidates.map(candidate => candidate.type)).toContain('STEP_GOAL_REST');
    expect(result.candidates.map(candidate => candidate.type)).not.toContain('UPCOMING_EVENT_TRANSIT');
    expect(result.exclusions.find(candidate => candidate.type === 'UPCOMING_EVENT_TRANSIT')?.code).toBe('PROVIDER_UNAVAILABLE');
    expect({ candidates, evidence }).toEqual(before);
  });

  it('preserves free-time and step-goal opportunities when routing-dependent candidates fail', async () => {
    const context = normalized(freeTime, { activity: ActivityContextSchema.parse(stepGoal.context.activity) });
    const candidates = await detectCandidates(context);
    const evidence = getScenarioEvidence(freeTime);
    evidence.routes = evidence.routes.map(entry => ({ ...entry, result: { status: 'timeout', data: null } }));
    const result = refineCandidates({ context, candidates, evidence });
    expect(result.candidates.map(candidate => candidate.type)).toEqual(['STEP_GOAL_REST', 'FREE_TIME_NEARBY']);
    for (const type of ['UPCOMING_EVENT_TRANSIT', 'EARLY_ARRIVAL_DETOUR']) {
      expect(result.exclusions.find(candidate => candidate.type === type)?.code).toBe('PROVIDER_UNAVAILABLE');
    }
  });

  it('filters missing signals per candidate rather than applying a global delivery guard', async () => {
    const context = normalized(upcomingTransit, { activity: ActivityContextSchema.parse(stepGoal.context.activity) });
    const seeds = await detectCandidates(context);
    const result = filterCandidatesBySignals(seeds, ['time', 'location', 'steps', 'places', 'preferences', 'weather']);
    expect(result.candidates.map(candidate => candidate.type)).toEqual(['STEP_GOAL_REST', 'WEATHER_ADAPTATION']);
    expect(result.exclusions.every(candidate => candidate.code === 'MISSING_REQUIRED_SIGNAL')).toBe(true);
  });

  it('reports missing numeric steps and does not trust a client reached flag', async () => {
    const candidates = await primaryCandidates(stepGoal);
    const context = normalized(stepGoal, { activity: { stepsToday: null, stepGoalReached: true } });
    const result = refineCandidates({ context, candidates, evidence: getScenarioEvidence(stepGoal) });
    expect(result.candidates).toEqual([]);
    expect(result.exclusions[0]?.code).toBe('MISSING_REQUIRED_SIGNAL');
  });

  it.each(['not_requested', 'unavailable', 'timeout', 'error'] as const)('keeps weather when Places are %s', async status => {
    const context = normalized(weatherAdaptation, { activity: ActivityContextSchema.parse(stepGoal.context.activity) });
    const candidates = await detectCandidates(context);
    const evidence = getScenarioEvidence(weatherAdaptation);
    evidence.places = [{ need: 'places-near-current', anchorKey: 'current', result: { status, data: null } }];
    const result = refineCandidates({ context, candidates, evidence });
    expect(result.candidates.map(candidate => candidate.type)).toEqual(['WEATHER_ADAPTATION']);
    expect(result.exclusions.find(candidate => candidate.type === 'STEP_GOAL_REST')?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('keeps free time when weather is outside the usable time window', async () => {
    const context = normalized(freeTime);
    const candidates = await detectCandidates(context);
    const evidence = getScenarioEvidence(freeTime);
    evidence.weather = [];
    const result = refineCandidates({ context, candidates, evidence });
    expect(result.candidates.map(candidate => candidate.type)).toContain('FREE_TIME_NEARBY');
    expect(result.candidates.map(candidate => candidate.type)).not.toContain('WEATHER_ADAPTATION');
  });

  it('does not use ambiguous geocoding for any anchored candidate but keeps nearby evidence', async () => {
    const context = normalized(upcomingTransit, { activity: ActivityContextSchema.parse(stepGoal.context.activity) });
    const candidates = await detectCandidates(context);
    const evidence = getScenarioEvidence(upcomingTransit);
    evidence.geocoding = evidence.geocoding.map(entry => ({ ...entry, result: { status: 'unavailable', data: null, code: 'GEOCODE_AMBIGUOUS' } }));
    const cafe = ProviderPlaceSchema.parse(stepGoal.providers.places.data?.[0]);
    evidence.places = [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'ok', data: [{
      ...cafe, latitude: context.location.latitude + 0.0001, longitude: context.location.longitude, distanceMeters: 12
    }] } }];
    const result = refineCandidates({ context, candidates, evidence });
    expect(result.candidates.map(candidate => candidate.type)).toContain('STEP_GOAL_REST');
    expect(result.exclusions.find(candidate => candidate.type === 'UPCOMING_EVENT_TRANSIT')?.code).toBe('GEOCODE_AMBIGUOUS');
  });

  it('deduplicates places, prefers known-open options and rejects conflicting place coordinates', async () => {
    const evidence = getScenarioEvidence(stepGoal);
    const cafe = ProviderPlaceSchema.parse(stepGoal.providers.places.data?.[0]);
    evidence.places = [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'degraded', data: [
      { ...cafe, placeId: 'unknown-hours', isOpen: null }, cafe, cafe
    ] } }];
    expect((await refined(stepGoal, {}, evidence)).candidates[0]?.facts.eligiblePlaceIds).toEqual([cafe.placeId, 'unknown-hours']);
    evidence.places = [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'ok', data: [
      cafe, { ...cafe, longitude: cafe.longitude + 1 }
    ] } }];
    expect((await refined(stepGoal, {}, evidence)).candidates).toEqual([]);
  });

  it('rebuilds facts from context and supplied providers without mutating input or duplicating anchors', async () => {
    const context = normalized(upcomingTransit);
    const candidates = await primaryCandidates(upcomingTransit);
    const first = candidates[0];
    if (!first) throw new Error('Expected candidate');
    first.facts.routeId = 'invented-route';
    first.facts.eventStartAt = '2000-01-01T00:00:00Z';
    const evidence = getScenarioEvidence(upcomingTransit);
    const before = structuredClone({ candidates, evidence });
    const result = refineCandidates({ context, candidates: [...candidates, ...candidates], evidence });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.facts.routeId).toBe('synthetic-route-1');
    expect(result.candidates[0]?.facts.eventStartAt).toBe(upcomingTransit.context.calendar[0]?.startAt);
    expect({ candidates, evidence }).toEqual(before);
  });

  it('uses the injected clock for real context instead of stale client or simulation timestamps', async () => {
    const context = ContextInputSchema.parse({
      ...upcomingTransit.context, mode: 'real', deliveryMode: 'proactive',
      capturedAt: '2000-01-01T00:00:00Z', scenarioTime: '2000-01-01T00:00:00Z'
    });
    const now = '2026-10-01T15:10:00+09:00';
    const input = normalizeDetectorContext({ context, preferences: upcomingTransit.preferences,
      profileTimezone: 'Asia/Tokyo', clock: { now: () => new Date(now) } });
    const candidates = await detectCandidates(input);
    expect(candidates.find(candidate => candidate.type === 'UPCOMING_EVENT_TRANSIT')?.facts.minutesUntilEvent).toBe(50);
    expect(candidates.find(candidate => candidate.type === 'WEATHER_ADAPTATION')?.facts.evaluationAt).toBe('2026-10-01T06:10:00.000Z');
  });

  it('keeps day anchors stable through the repeated DST hour and changes them at local midnight', async () => {
    const fixture = { ...weatherAdaptation, preferences: { ...weatherAdaptation.preferences, timezone: 'America/New_York' } };
    const earlier = await primaryCandidates(fixture, { scenarioTime: '2026-11-01T01:30:00-04:00' });
    const later = await primaryCandidates(fixture, { scenarioTime: '2026-11-01T01:30:00-05:00' });
    const midnight = await primaryCandidates(fixture, { scenarioTime: '2026-11-02T00:00:00-05:00' });
    expect(earlier[0]?.anchorKey).toBe(later[0]?.anchorKey);
    expect(midnight[0]?.anchorKey).not.toBe(later[0]?.anchorKey);
  });

  it('validates configuration at factory creation without weakening delivery policy', () => {
    for (const policy of [
      { ...defaultDetectorPolicy, minimumGapMinutes: 0 },
      { ...defaultDetectorPolicy, upcomingEventHorizonMinutes: Number.POSITIVE_INFINITY },
      { ...defaultDetectorPolicy, maximumFreeTimeMinutes: 10 }
    ]) {
      expect(DetectorPolicySchema.safeParse(policy).success).toBe(false);
      expect(() => createDetectorRegistry(policy)).toThrow();
    }
  });

  it('measures geographical distance across the date line and near the poles', () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111_194.927, 2);
    expect(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 })).toBeCloseTo(222.390, 2);
    expect(distanceMeters({ latitude: 90, longitude: 0 }, { latitude: 90, longitude: 180 })).toBeLessThan(0.001);
  });
});

describe('five-scenario delivery guard compatibility', () => {
  it.each(scenarios)('$id remains repeatable in preview with suppression diagnostics and no state mutation', async fixture => {
    const context = normalized(fixture);
    const seeds = await primaryCandidates(fixture);
    const candidate = CandidateOpportunitySchema.parse(seeds[0]);
    const state = {
      notificationDay: '2026-10-01', notificationsSentToday: 1,
      latestContextFingerprint: 'same', latestContextProcessedAt: '2026-10-01T05:09:59Z',
      recentAnchors: [{ triggerType: candidate.type, anchorKey: candidate.anchorKey, notifiedAt: '2026-10-01T05:09:59Z' }]
    };
    const before = structuredClone(state);
    const base = { clock: { now: () => new Date('2026-10-01T05:10:00Z') }, preferences: fixture.preferences,
      profileTimezone: fixture.preferences.timezone, contextFingerprint: 'same', opportunity: candidate, state };
    expect(evaluateDeliveryGuards({ ...base, deliveryMode: 'proactive' }).shouldEvaluate).toBe(false);
    for (let run = 0; run < 2; run++) {
      expect(evaluateDeliveryGuards({ ...base, deliveryMode: 'preview' })).toMatchObject({
        shouldEvaluate: true, wouldSuppress: true, guardCodes: ['DUPLICATE_CONTEXT', 'RECENT_SAME_TRIGGER']
      });
      expect(refineCandidates({ context, candidates: seeds, evidence: getScenarioEvidence(fixture) }).candidates).toHaveLength(1);
      expect(state).toEqual(before);
    }
    expect(evaluateDeliveryGuards({ ...base, contextFingerprint: 'changed', deliveryMode: 'proactive',
      clock: { now: () => new Date('2026-10-01T05:39:59Z') } }).shouldEvaluate).toBe(candidate.type !== 'STEP_GOAL_REST');
  });
});
