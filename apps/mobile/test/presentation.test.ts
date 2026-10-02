import { describe, expect, it } from 'vitest';
import { evaluationPresentation, failureMessage, nextCalendarEvent, parsePreferencesDraft, preferencesDraft } from '../src/screens/presentation';
import { notify, profile, silent } from './support/data';

describe('mobile presentation', () => {
  it('shows notify cards and used signals, and renders silent without old recommendations', () => {
    expect(evaluationPresentation(notify)).toMatchObject({ title: '今のあなたへの提案', message: notify.message, cards: notify.recommendations, signals: ['現在地', '予定'] });
    expect(evaluationPresentation(silent)).toMatchObject({ message: null, cards: [], guards: ['直近に同じ状況を評価しました'] });
  });
  it.each([401, 403, 404, 429, 503])('has a user-facing HTTP %i explanation', status => {
    expect(failureMessage({ kind: 'http-error', status, code: 'HTTP_ERROR', requestId: null })).not.toBe('処理に失敗しました。もう一度お試しください。');
  });
  it('selects the next overlapping/future timed event, excluding expired and all-day items', () => {
    const events = [
      { id: 'expired', title: 'Expired', startAt: '2026-10-02T00:00:00Z', endAt: '2026-10-02T00:30:00Z' },
      { id: 'later', title: 'Later', startAt: '2026-10-02T04:00:00Z', endAt: '2026-10-02T05:00:00Z' },
      { id: 'all-day', title: 'All day', startAt: '2026-10-01T15:00:00Z', endAt: '2026-10-02T15:00:00Z', allDay: true },
      { id: 'next', title: 'Next', startAt: '2026-10-02T02:00:00Z', endAt: '2026-10-02T03:00:00Z' }
    ];
    expect(nextCalendarEvent(events, new Date('2026-10-02T01:00:00Z'))?.id).toBe('next');
    expect(events[0]?.id).toBe('expired');
  });
  it('keeps saved preferences intact and rejects invalid edits', () => {
    const draft = preferencesDraft(profile.preferences);
    expect(parsePreferencesDraft(draft).success).toBe(true);
    expect(parsePreferencesDraft({ ...draft, stepGoal: '' }).success).toBe(false);
    expect(parsePreferencesDraft({ ...draft, stepGoal: '1.2' }).success).toBe(false);
    expect(parsePreferencesDraft({ ...draft, timezone: 'Asia/Invalid' }).success).toBe(false);
    const parsed = parsePreferencesDraft({ ...draft, interests: 'cafe、 park, museum' });
    expect(parsed.success && parsed.data.interests).toEqual(['cafe', 'park', 'museum']);
    expect(profile.preferences.interests).toEqual(['cafe']);
  });
});
