import { describe, expect, it } from 'vitest';
import type { ContextInput } from '@contextia/contracts';
import { getScenarioInput, scenarios } from '@contextia/test-fixtures';
import { createEvaluationDomain, secondsSinceLocalMidnight, toGuardState } from '../src/composition/evaluationDomain.js';
import type { PersistedUserState } from '../src/composition/evaluationDomain.js';

// 2026-10-01 14:10 Asia/Tokyo
const NOW = new Date('2026-10-01T05:10:00.000Z');
const fixture = scenarios.find(value => value.id === 'step-goal');
if (!fixture) throw new Error('step-goal fixture missing');
const preferences = fixture.preferences;
const preview: ContextInput = getScenarioInput('step-goal');
const proactive: ContextInput = { ...preview, mode: 'real', deliveryMode: 'proactive', location: { ...preview.location, source: 'gps' } };
const domain = createEvaluationDomain();
const state = (overrides: Partial<PersistedUserState> = {}): PersistedUserState => ({
  notificationDay: '2026-10-01', notificationsSentToday: 0, recentAnchors: [], ...overrides
});
const guard = (deliveryMode: 'preview' | 'proactive', userState: PersistedUserState | null, opportunity?: { type: 'STEP_GOAL_REST'; anchorKey: string }) =>
  domain.checkDeliveryGuards({ now: NOW, deliveryMode, preferences, state: userState, contextFingerprint: 'fp-1', ...(opportunity ? { opportunity } : {}) });

describe('createEvaluationDomain (lane A guards and detectors)', () => {
  it('detects STEP_GOAL_REST with a local-date anchor for a reached goal', async () => {
    const candidates = await domain.detectCandidates({ context: preview, preferences, now: NOW });
    expect(candidates).toEqual([expect.objectContaining({ type: 'STEP_GOAL_REST', anchorKey: '2026-10-01', providerNeeds: ['places-near-current'] })]);
  });

  it('returns no candidate below the step goal', async () => {
    const below = { ...preview, activity: { ...preview.activity, stepsToday: 4_000 } };
    expect(await domain.detectCandidates({ context: below, preferences, now: NOW })).toEqual([]);
  });

  it('applies the profile cap and resolves the local notification day', () => {
    expect(guard('proactive', state({ notificationsSentToday: 3 }))).toMatchObject({
      shouldEvaluate: false, guardCodes: ['DAILY_CAP_REACHED'], notificationDay: '2026-10-01', maxDailyNotifications: 3
    });
  });

  it('keeps preview evaluating while reporting suppression', () => {
    expect(guard('preview', state({ notificationsSentToday: 3 }))).toMatchObject({ shouldEvaluate: true, guardCodes: ['DAILY_CAP_REACHED'] });
  });

  it('suppresses a second step-goal notification on the same local day', () => {
    const notified = state({ recentAnchors: [{ triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: '2026-09-30T23:30:00.000Z' }] });
    expect(guard('proactive', notified, { type: 'STEP_GOAL_REST', anchorKey: '2026-10-01' }).guardCodes).toEqual(['RECENT_SAME_TRIGGER']);
  });

  it('passes the local-day anchor window to the repository recheck as seconds since local midnight', () => {
    expect(guard('proactive', null, { type: 'STEP_GOAL_REST', anchorKey: '2026-10-01' }).anchorDedupSeconds).toBe(14 * 3600 + 10 * 60);
  });

  it('does not throw on a repeated context while the server processing time is missing (#5)', () => {
    const repeated = state({ latestContextFingerprint: 'fp-1' });
    expect(() => guard('preview', repeated)).not.toThrow();
    expect(guard('proactive', repeated).guardCodes).toEqual([]);
  });

  it('reports DUPLICATE_CONTEXT once the server processing time is available', () => {
    const repeated = state({ latestContextFingerprint: 'fp-1', latestContextProcessedAt: '2026-10-01T05:08:00.000Z' });
    expect(guard('proactive', repeated)).toMatchObject({ shouldEvaluate: false, guardCodes: ['DUPLICATE_CONTEXT'] });
  });

  it('runs real-mode detection on the server clock, not the client capture time', async () => {
    const stale = { ...proactive, capturedAt: '2026-09-30T05:10:00.000Z' };
    const [candidate] = await domain.detectCandidates({ context: stale, preferences, now: NOW });
    expect(candidate?.anchorKey).toBe('2026-10-01');
  });
});

describe('toGuardState', () => {
  it('withholds the fingerprint unless its processing time is known', () => {
    expect(toGuardState(state({ latestContextFingerprint: 'fp-1' }))).not.toHaveProperty('latestContextFingerprint');
    expect(toGuardState(null)).toBeNull();
  });
});

describe('secondsSinceLocalMidnight', () => {
  it('uses the IANA timezone', () => {
    expect(secondsSinceLocalMidnight(NOW, 'Asia/Tokyo')).toBe(50_400 + 600);
    expect(secondsSinceLocalMidnight(NOW, 'UTC')).toBe(5 * 3600 + 600);
  });
});
