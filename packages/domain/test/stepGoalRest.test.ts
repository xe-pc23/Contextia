import { describe, expect, it } from 'vitest';
import { CandidateOpportunitySchema, ContextInputSchema } from '@contextia/contracts';
import type { ActivityContext, CandidateOpportunity, ContextInput, UserPreferences } from '@contextia/contracts';
import { stepGoal, stepGoalBelowGoal, stepGoalStepsUnavailable } from '@contextia/test-fixtures';
import { evaluateDeliveryGuards } from '../src/guards/deliveryGuards.js';
import type { DeliveryGuardState } from '../src/guards/deliveryGuards.js';
import { normalizeDetectorContext } from '../src/triggers/detectorContext.js';
import type { NormalizeDetectorContextInput } from '../src/triggers/detectorContext.js';
import { stepGoalRestDetector } from '../src/triggers/stepGoalRest.js';

const now = '2026-10-01T05:10:00Z';
const fixedClock = (at = now) => ({ now: () => new Date(at) });
const preferences = stepGoal.preferences;
function normalized(context: ContextInput = stepGoal.context, patch: Partial<NormalizeDetectorContextInput> = {}) {
  return normalizeDetectorContext({ context, preferences, clock: fixedClock(), profileTimezone: preferences.timezone, ...patch });
}
function withActivity(activity: ActivityContext): ContextInput {
  return ContextInputSchema.parse({ ...stepGoal.context, activity });
}
function at(scenarioTime: string): ContextInput {
  return ContextInputSchema.parse({ ...stepGoal.context, scenarioTime });
}
function guard(opportunity: CandidateOpportunity, state: DeliveryGuardState, deliveryMode: 'preview' | 'proactive', atTime = now) {
  return evaluateDeliveryGuards({
    clock: fixedClock(atTime), preferences, profileTimezone: preferences.timezone,
    contextFingerprint: 'sha256:step-goal', opportunity, state, deliveryMode
  });
}

describe('STEP_GOAL_REST detector', () => {
  it('detects the positive fixture and declares only nearby Places enrichment', async () => {
    const candidates = await stepGoalRestDetector.detect(normalized());
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate).toMatchObject({
      type: stepGoal.primaryTrigger, anchorKey: '2026-10-01', confidence: 1,
      requiredSignals: ['steps', 'location', 'time'], providerNeeds: stepGoal.providerNeeds,
      facts: { stepsToday: 10_432, stepGoal: 10_000, stepGoalReached: true, stepSource: 'scenario' }
    });
    expect(CandidateOpportunitySchema.parse(candidate)).toEqual(candidate);
  });

  it('does not detect the below-goal or unavailable-step negative fixtures', async () => {
    for (const fixture of [stepGoalBelowGoal, stepGoalStepsUnavailable]) {
      expect(await stepGoalRestDetector.detect(normalized(fixture.context))).toEqual([]);
    }
  });

  it.each([9_999, 10_000, 10_001])('checks the inclusive goal boundary at %i steps', async stepsToday => {
    const candidates = await stepGoalRestDetector.detect(normalized(withActivity({ stepsToday, stepGoal: 10_000 })));
    expect(candidates).toHaveLength(stepsToday >= 10_000 ? 1 : 0);
  });

  it.each([1, 200_000])('supports the contract goal boundary %i', async stepGoalValue => {
    const context = withActivity({ stepsToday: stepGoalValue, stepGoal: stepGoalValue });
    expect(await stepGoalRestDetector.detect(normalized(context))).toHaveLength(1);
  });

  it.each([true, false])('uses numeric evidence regardless of client reached=%s', async stepGoalReached => {
    expect(await stepGoalRestDetector.detect(normalized(withActivity({ stepsToday: 10_000, stepGoalReached })))).toHaveLength(1);
    expect(await stepGoalRestDetector.detect(normalized(withActivity({ stepsToday: 9_999, stepGoalReached })))).toEqual([]);
  });

  it('requires a numeric step count even when the client reached flag is true', async () => {
    const noActivity = { ...stepGoal.context };
    delete noActivity.activity;
    for (const context of [noActivity, withActivity({ stepGoalReached: true }), withActivity({ stepsToday: null, stepGoalReached: true })]) {
      expect(await stepGoalRestDetector.detect(normalized(context))).toEqual([]);
    }
  });

  it.each(['real', 'simulation'] as const)('prefers activity goal over effective preferences in %s', async mode => {
    const context = ContextInputSchema.parse({
      ...stepGoal.context, mode, deliveryMode: mode === 'real' ? 'proactive' : 'preview',
      activity: { stepsToday: 5_000, stepGoal: 5_000 }
    });
    const candidates = await stepGoalRestDetector.detect(normalized(context));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.facts.stepGoal).toBe(5_000);
  });

  it('falls back to normalized preferences when activity goal is missing or null', async () => {
    const effective: UserPreferences = { ...preferences, stepGoal: 5_000 };
    for (const activity of [{ stepsToday: 5_000 }, { stepsToday: 5_000, stepGoal: null }]) {
      const candidates = await stepGoalRestDetector.detect(normalized(withActivity(activity), { preferences: effective }));
      expect(candidates[0]?.facts.stepGoal).toBe(5_000);
    }
  });

  it('preserves low-confidence steps as a candidate with lower confidence', async () => {
    const confidenceScores: number[] = [];
    for (const confidence of ['low', 'medium', 'high'] as const) {
      const candidates = await stepGoalRestDetector.detect(normalized(withActivity({ stepsToday: 10_000, confidence, stepSource: 'foreground-sensor' })));
      expect(candidates).toHaveLength(1);
      confidenceScores.push(candidates[0]?.confidence ?? -1);
      expect(candidates[0]?.facts.stepConfidence).toBe(confidence);
    }
    expect(confidenceScores[0]).toBeLessThan(confidenceScores[1] ?? -1);
    expect(confidenceScores[1]).toBeLessThan(confidenceScores[2] ?? -1);
  });

  it('leaves imminent-calendar relevance to later evaluation', async () => {
    const context = ContextInputSchema.parse({ ...stepGoal.context, calendar: [{
      id: 'imminent', title: 'Meeting', startAt: now, endAt: '2026-10-01T06:10:00Z'
    }] });
    expect(await stepGoalRestDetector.detect(normalized(context))).toHaveLength(1);
  });
});

describe('step-goal evaluation time and timezone', () => {
  it('uses scenarioTime, then capturedAt, without reading the real evaluation clock', () => {
    const clock = { now: (): Date => { throw new Error('Simulation must not read the real clock'); } };
    const context = at('2030-01-02T00:05:00+09:00');
    expect(normalized(context, { clock }).evaluationAt.toISOString()).toBe('2030-01-01T15:05:00.000Z');
    const noScenarioTime = { ...context };
    delete noScenarioTime.scenarioTime;
    expect(normalized(noScenarioTime, { clock }).evaluationAt.toISOString()).toBe(new Date(context.capturedAt).toISOString());
  });

  it('uses the injected evaluation clock for real context regardless of stale capturedAt/scenarioTime', async () => {
    const context = ContextInputSchema.parse({ ...at('2000-01-01T00:00:00Z'), mode: 'real', deliveryMode: 'proactive' });
    const input = normalized(context, { clock: fixedClock('2026-10-01T15:00:00Z') });
    expect(input.evaluationAt.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect((await stepGoalRestDetector.detect(input))[0]?.anchorKey).toBe('2026-10-02');
  });

  it.each([
    { profileTimezone: 'Asia/Tokyo', clientTimezone: 'America/Los_Angeles', date: '2026-10-01' },
    { profileTimezone: 'invalid/profile', clientTimezone: 'America/Los_Angeles', date: '2026-09-30' },
    { profileTimezone: undefined, clientTimezone: 'America/Los_Angeles', date: '2026-09-30' },
    { profileTimezone: 'invalid/profile', clientTimezone: 'invalid/client', date: '2026-10-01' }
  ])('anchors to resolved profile/client/UTC date: $date', async ({ profileTimezone, clientTimezone, date }) => {
    const input = normalized(at('2026-10-01T00:01:00Z'), { profileTimezone, clientTimezone });
    expect((await stepGoalRestDetector.detect(input))[0]?.anchorKey).toBe(date);
  });

  it('changes the anchor at local midnight while the UTC calendar day is unchanged', async () => {
    const before = normalized(at('2026-10-01T06:59:59Z'), { profileTimezone: 'America/Los_Angeles' });
    const after = normalized(at('2026-10-01T07:00:00Z'), { profileTimezone: 'America/Los_Angeles' });
    expect((await stepGoalRestDetector.detect(before))[0]?.anchorKey).toBe('2026-09-30');
    expect((await stepGoalRestDetector.detect(after))[0]?.anchorKey).toBe('2026-10-01');
  });

  it('keeps one anchor during the repeated hour when DST ends', async () => {
    const anchors: (string | undefined)[] = [];
    for (const scenarioTime of ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00']) {
      const input = normalized(at(scenarioTime), { profileTimezone: 'America/New_York' });
      anchors.push((await stepGoalRestDetector.detect(input))[0]?.anchorKey);
    }
    expect(anchors).toEqual(['2026-11-01', '2026-11-01']);
  });

  it.each([
    ['2026-03-08T00:05:00-05:00', '2026-03-09T00:05:00-04:00', '2026-03-08', '2026-03-09'],
    ['2026-11-01T00:05:00-04:00', '2026-11-02T00:05:00-05:00', '2026-11-01', '2026-11-02']
  ])('changes the day anchor across DST between %s and %s', async (beforeAt, afterAt, beforeDay, afterDay) => {
    const before = normalized(at(beforeAt), { profileTimezone: 'America/New_York' });
    const after = normalized(at(afterAt), { profileTimezone: 'America/New_York' });
    expect((await stepGoalRestDetector.detect(before))[0]?.anchorKey).toBe(beforeDay);
    expect((await stepGoalRestDetector.detect(after))[0]?.anchorKey).toBe(afterDay);
  });
});

describe('step-goal delivery guard integration', () => {
  it('detects reached state on repeated input while the guard prevents recent same-day delivery', async () => {
    const candidates = await stepGoalRestDetector.detect(normalized());
    const opportunity = CandidateOpportunitySchema.parse(candidates[0]);
    const state: DeliveryGuardState = {
      notificationDay: '2026-10-01', notificationsSentToday: 1,
      recentAnchors: [{ triggerType: 'STEP_GOAL_REST', anchorKey: opportunity.anchorKey, notifiedAt: now }]
    };
    expect(await stepGoalRestDetector.detect(normalized())).toEqual(candidates);
    expect(guard(opportunity, state, 'proactive').guardCodes).toEqual(['RECENT_SAME_TRIGGER']);
    expect(guard(opportunity, state, 'proactive').shouldEvaluate).toBe(false);
    expect(guard(opportunity, state, 'proactive', '2026-10-01T05:40:00Z').shouldEvaluate).toBe(true);
  });

  it('allows a new local-day anchor without an added whole-day suppression policy', async () => {
    const opportunity = CandidateOpportunitySchema.parse((await stepGoalRestDetector.detect(normalized(at('2026-10-02T00:00:00+09:00'))))[0]);
    const state: DeliveryGuardState = {
      notificationDay: '2026-10-01', notificationsSentToday: 1,
      recentAnchors: [{ triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: '2026-10-01T14:59:59Z' }]
    };
    expect(opportunity.anchorKey).toBe('2026-10-02');
    expect(guard(opportunity, state, 'proactive', '2026-10-01T15:00:00Z').guardCodes).toEqual([]);
  });

  it('reevaluates repeated preview with diagnostics without consuming or mutating delivery state', async () => {
    const context = at('2000-01-01T14:10:00+09:00');
    const initialCandidates = await stepGoalRestDetector.detect(normalized(context));
    const opportunity = CandidateOpportunitySchema.parse(initialCandidates[0]);
    const state: DeliveryGuardState = {
      notificationDay: '2026-10-01', notificationsSentToday: 3, recentAnchors: [],
      latestContextFingerprint: 'sha256:step-goal', latestContextProcessedAt: now
    };
    const before = structuredClone(state);
    for (let run = 0; run < 2; run++) {
      const result = guard(opportunity, state, 'preview');
      expect(result).toMatchObject({
        shouldEvaluate: true, wouldSuppress: true, notificationDay: '2026-10-01',
        guardCodes: ['DAILY_CAP_REACHED', 'DUPLICATE_CONTEXT'],
        delivery: { mode: 'preview', status: 'preview', wouldSuppress: true }
      });
      expect(await stepGoalRestDetector.detect(normalized(context))).toEqual(initialCandidates);
      expect(state).toEqual(before);
    }
    expect(opportunity.anchorKey).toBe('2000-01-01');
    expect(guard(opportunity, state, 'proactive').shouldEvaluate).toBe(false);
  });
});
