import { describe, expect, it } from 'vitest';
import type { ContextInput } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import { contextFingerprint, hashCalendarId } from '../src/application/fingerprint.js';

const base: ContextInput = getScenarioInput('step-goal');

describe('contextFingerprint', () => {
  it('allows a newly available empty calendar to be evaluated again', () => {
    expect(contextFingerprint({ ...base, calendarStatus: 'denied' })).not.toBe(contextFingerprint({ ...base, calendarStatus: 'granted' }));
    expect(contextFingerprint({ ...base, calendarStatus: 'granted' })).toBe(contextFingerprint(base));
  });
  it('is stable for small location, time and step changes inside the same buckets', () => {
    const nudged = { ...base, location: { ...base.location, latitude: base.location.latitude + 0.0001 }, activity: { ...base.activity, stepsToday: 10_440 } };
    expect(contextFingerprint(nudged)).toBe(contextFingerprint(base));
  });

  it('changes with mode, a new time bucket or a new step bucket', () => {
    const fingerprint = contextFingerprint(base);
    expect(contextFingerprint({ ...base, mode: 'real', deliveryMode: 'proactive' })).not.toBe(fingerprint);
    expect(contextFingerprint({ ...base, scenarioTime: '2026-10-01T14:20:00+09:00' })).not.toBe(fingerprint);
    expect(contextFingerprint({ ...base, activity: { ...base.activity, stepsToday: 11_000 } })).not.toBe(fingerprint);
  });

  it('contains no raw location or calendar data', () => {
    const context = { ...base, calendar: [{ id: 'device-event-1', title: 'Doctor', startAt: '2026-10-01T16:00:00+09:00', endAt: '2026-10-01T17:00:00+09:00' }] };
    const fingerprint = contextFingerprint(context);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toBe(contextFingerprint(base));
    expect(hashCalendarId('device-event-1')).not.toContain('device-event-1');
  });
  it('ignores simulation time in a real input', () => {
    const real = { ...base, mode: 'real' as const, deliveryMode: 'proactive' as const };
    expect(contextFingerprint({ ...real, scenarioTime: '2026-10-04T14:20:00+09:00' })).toBe(contextFingerprint(real));
    expect(contextFingerprint({ ...real, capturedAt: '2026-10-04T14:20:00+09:00' })).not.toBe(contextFingerprint(real));
  });
});
