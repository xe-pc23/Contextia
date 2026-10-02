import { describe, expect, it } from 'vitest';
import {
  ActivityContextSchema, CalendarEventContextSchema, ContextInputSchema,
  GeoPointSchema, TimestampSchema, UserPreferencesSchema
} from '../src/index.js';

const timestamp = '2026-10-01T14:10:00+09:00';
const event = { id: 'event-1', title: 'Meeting', startAt: timestamp, endAt: '2026-10-01T15:10:00+09:00' };
const preferences = {
  interests: ['cafe'], stepGoal: 10_000, notificationFrequency: 'normal',
  notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo'
};
const context = {
  mode: 'simulation', deliveryMode: 'preview', capturedAt: timestamp, scenarioTime: timestamp,
  location: { latitude: 35.681236, longitude: 139.767125, capturedAt: timestamp, source: 'scenario' },
  calendar: [event], activity: { stepsToday: 10_000, stepGoal: 10_000, stepSource: 'scenario' }
};

describe('v1 context validation', () => {
  it.each(['denied', 'unavailable'] as const)('distinguishes %s calendar from an available empty calendar', calendarStatus => {
    expect(ContextInputSchema.safeParse({ ...context, calendar: [], calendarStatus }).success).toBe(true);
    expect(ContextInputSchema.safeParse({ ...context, calendarStatus }).success).toBe(false);
    expect(ContextInputSchema.safeParse({ ...context, calendarStatus: 'granted' }).success).toBe(true);
  });
  it('accepts the two production mode/delivery pairs without changing an offset', () => {
    expect(ContextInputSchema.parse(context).scenarioTime).toBe(timestamp);
    expect(ContextInputSchema.parse({ ...context, mode: 'real', deliveryMode: 'proactive', location: { ...context.location, source: 'gps' } }).mode).toBe('real');
  });

  it.each([
    { mode: 'real', deliveryMode: 'preview' }, { mode: 'simulation', deliveryMode: 'proactive' },
    { force: true }, { calendar: Array.from({ length: 101 }, () => event) },
    { preferencesOverride: { timezone: 'Mars/Olympus' } }, { capturedAt: '2026-10-01T14:10:00' },
    { location: { ...context.location, accuracyMeters: -1 } },
    { location: { ...context.location, accuracyMeters: 100_001 } },
    { location: { ...context.location, latitude: 90.01 } }
  ])('rejects invalid context patch %j', patch => {
    expect(ContextInputSchema.safeParse({ ...context, ...patch }).success).toBe(false);
  });

  it('accepts calendar and accuracy limits', () => {
    expect(ContextInputSchema.safeParse({ ...context, calendar: Array.from({ length: 100 }, () => event), location: { ...context.location, accuracyMeters: 100_000 } }).success).toBe(true);
  });

  it.each([
    { latitude: -90, longitude: -180 }, { latitude: 90, longitude: 180 }, { latitude: 0, longitude: 0 }
  ])('accepts coordinate boundaries %j', point => expect(GeoPointSchema.safeParse(point).success).toBe(true));

  it.each([
    { latitude: -90.01, longitude: 0 }, { latitude: 0, longitude: 180.01 },
    { latitude: Number.NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
    { latitude: '35', longitude: 139 }
  ])('rejects invalid coordinates %j', point => expect(GeoPointSchema.safeParse(point).success).toBe(false));

  it.each(['2026-02-30T12:00:00Z', 'not-a-date', '2026-10-01T12:00:00', '2026-10-01T12:00:00+25:00'])('rejects invalid timestamp %s', value => {
    expect(TimestampSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { endAt: '2026-10-01T14:09:59+09:00' }, { endAt: '2026-11-01T14:10:01+09:00' },
    { id: '' }, { id: 'x'.repeat(129) }, { title: 'x'.repeat(201) }, { location: 'x'.repeat(201) },
    { attendees: [{ email: 'private@example.invalid' }] }, { description: 'private notes' }, { meetingUrl: 'https://example.invalid' }
  ])('rejects invalid/private calendar fields %j', patch => {
    expect(CalendarEventContextSchema.safeParse({ ...event, ...patch }).success).toBe(false);
  });

  it('allows equal timestamps, nullable locations, and long all-day events', () => {
    expect(CalendarEventContextSchema.safeParse({ ...event, endAt: timestamp, location: null }).success).toBe(true);
    expect(CalendarEventContextSchema.safeParse({ ...event, endAt: '2026-11-01T14:10:00+09:00', location: '' }).success).toBe(true);
    expect(CalendarEventContextSchema.safeParse({ ...event, endAt: '2026-12-01T14:10:00+09:00', allDay: true }).success).toBe(true);
  });

  it.each([
    { stepsToday: -1 }, { stepsToday: 200_001 }, { stepsToday: 0.5 },
    { stepGoal: 0 }, { stepGoal: 200_001 }, { stepSource: 'android-pedometer-history' }
  ])('rejects invalid activity %j', activity => expect(ActivityContextSchema.safeParse(activity).success).toBe(false));

  it('accepts unavailable steps and valid activity boundaries', () => {
    expect(ActivityContextSchema.safeParse({ stepsToday: null, stepGoal: null }).success).toBe(true);
    expect(ActivityContextSchema.safeParse({ stepsToday: 200_000, stepGoal: 200_000, stepGoalReached: true }).success).toBe(true);
    expect(ActivityContextSchema.safeParse({ stepsToday: 0, stepGoal: 1 }).success).toBe(true);
  });

  it.each([
    { interests: Array.from({ length: 21 }, () => 'cafe') }, { interests: [''] }, { interests: ['x'.repeat(65)] },
    { locale: 'j' }, { locale: 'x'.repeat(36) }, { timezone: '+09:00' }, { timezone: 'Mars/Olympus' },
    { stepGoal: 0 }, { stepGoal: 200_001 }, { notificationsEnabled: 'true' }
  ])('rejects invalid preferences %j', patch => {
    expect(UserPreferencesSchema.safeParse({ ...preferences, ...patch }).success).toBe(false);
  });

  it('accepts profile preferences, partial overrides and UTC fallback', () => {
    expect(UserPreferencesSchema.parse(preferences).timezone).toBe('Asia/Tokyo');
    expect(UserPreferencesSchema.parse({ ...preferences, timezone: 'UTC' }).timezone).toBe('UTC');
    expect(ContextInputSchema.parse({ ...context, preferencesOverride: { interests: [] } }).preferencesOverride).toEqual({ interests: [] });
  });
});
