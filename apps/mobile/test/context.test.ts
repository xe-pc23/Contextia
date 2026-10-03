import { CalendarEventContextSchema, ContextInputSchema, type LocationContext } from '@contextia/contracts';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { getCalendarQueryWindow, getCalendarReadWindow } from '../src/context/calendarWindow';
import { projectCalendarEvents } from '../src/context/calendarProjection';
import { ContextCollector } from '../src/context/contextCollector';
import type { CalendarReadResult, CalendarSource, ClockSource, LocationReadResult, LocationSource, StepSource } from '../src/context/types';

const fixedNow = new Date('2026-05-01T12:00:00.000Z');
const location: LocationContext = {
  latitude: 35.6812,
  longitude: 139.7671,
  accuracyMeters: 12,
  capturedAt: fixedNow.toISOString(),
  source: 'gps'
};

class FixedClock implements ClockSource {
  now(): Date {
    return fixedNow;
  }
}

class StubLocationSource implements LocationSource {
  constructor(private readonly result: LocationReadResult) {}
  async readCurrentLocation(): Promise<LocationReadResult> {
    return this.result;
  }
}

class StubCalendarSource implements CalendarSource {
  constructor(private readonly result: CalendarReadResult) {}
  async readUpcomingEvents(): Promise<CalendarReadResult> {
    return this.result;
  }
}

describe('Calendar context projection', () => {
  it('distinguishes recurring instances and keeps equivalent start instants stable', async () => {
    const window = getCalendarReadWindow(new Date('2026-05-01T12:00:00.000Z'));
    const hash = async (identity: string) => createHash('sha256').update(identity).digest('hex');
    const event = { id: 'recurring-series', title: 'Daily meeting', startDate: '2026-05-01T13:00:00Z', endDate: '2026-05-01T14:00:00Z' };
    const projected = await projectCalendarEvents([event,
      { ...event, startDate: '2026-05-02T13:00:00Z', endDate: '2026-05-02T14:00:00Z' }], window, hash);
    expect(projected).toHaveLength(2); expect(projected[0]?.id).not.toBe(projected[1]?.id);
    const offset = await projectCalendarEvents([{ ...event, startDate: '2026-05-01T22:00:00+09:00' }], window, hash);
    expect(offset[0]?.id).toBe(projected[0]?.id);
  });
  it('hashes the native ID and emits only contract-allowed fields', async () => {
    const window = getCalendarReadWindow(new Date(2026, 4, 1, 12));
    const projected = await projectCalendarEvents([{
      id: 'native-calendar-event-secret',
      title: '  Planning  ',
      startDate: new Date(2026, 4, 1, 13),
      endDate: new Date(2026, 4, 1, 14),
      location: ' Room 4 ',
      allDay: false,
      attendees: [{ email: 'private@example.test' }],
      description: 'private notes',
      notes: 'other private notes',
      meetingUrl: 'https://meet.example.test/private',
      organizerEmail: 'organizer@example.test'
    }], window, async () => 'evt_hash_001');

    expect(projected).toEqual([{
      id: 'evt_hash_001',
      title: 'Planning',
      startAt: new Date(2026, 4, 1, 13).toISOString(),
      endAt: new Date(2026, 4, 1, 14).toISOString(),
      location: 'Room 4',
      allDay: false
    }]);
    expect(CalendarEventContextSchema.safeParse(projected[0]).success).toBe(true);
    const serialized = JSON.stringify(projected);
    for (const privateValue of ['native-calendar-event-secret', 'private@example.test', 'private notes', 'meet.example.test']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('uses local-day boundaries through the end of the next three days', () => {
    const window = getCalendarReadWindow(new Date(2026, 4, 1, 12, 45));
    expect(window.startInclusive).toEqual(new Date(2026, 4, 1, 0, 0));
    expect(window.endExclusive).toEqual(new Date(2026, 4, 5, 0, 0));
  });

  it('pads the native query by the maximum non-all-day event duration', () => {
    const window = getCalendarReadWindow(new Date(2026, 4, 1, 12));
    const queryWindow = getCalendarQueryWindow(window);
    const maxEventDurationMs = 31 * 24 * 60 * 60 * 1000;

    expect(queryWindow.startInclusive.getTime()).toBe(window.startInclusive.getTime() - maxEventDurationMs);
    expect(queryWindow.endExclusive.getTime()).toBe(window.endExclusive.getTime() + maxEventDurationMs);
  });

  it('keeps events that overlap either side of the requested window', async () => {
    const window = getCalendarReadWindow(new Date(2026, 4, 1, 12));
    const events = await projectCalendarEvents([
      {
        id: 'starts-before-window',
        title: 'Overnight event',
        startDate: new Date(window.startInclusive.getTime() - 60 * 60 * 1000),
        endDate: new Date(window.startInclusive.getTime() + 60 * 60 * 1000)
      },
      {
        id: 'ends-after-window',
        title: 'Late event',
        startDate: new Date(window.endExclusive.getTime() - 60 * 60 * 1000),
        endDate: new Date(window.endExclusive.getTime() + 60 * 60 * 1000)
      }
    ], window, async id => `hash-${(JSON.parse(id) as [string, number])[0]}`);

    expect(events.map(event => event.id)).toEqual(['hash-starts-before-window', 'hash-ends-after-window']);
  });

  it.each([
    {
      timezone: 'Asia/Tokyo',
      localTodayStartUtc: '2026-04-30T15:00:00.000Z',
      localTomorrowStartUtc: '2026-05-01T15:00:00.000Z'
    },
    {
      timezone: 'America/Los_Angeles',
      localTodayStartUtc: '2026-05-01T07:00:00.000Z',
      localTomorrowStartUtc: '2026-05-02T07:00:00.000Z'
    }
  ])('normalizes Android all-day UTC dates to local midnight in $timezone', async ({
    timezone,
    localTodayStartUtc,
    localTomorrowStartUtc
  }) => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = timezone;
    try {
      const window = getCalendarReadWindow(new Date('2026-05-01T12:00:00.000Z'));
      const events = await projectCalendarEvents([
        {
          id: 'previous-day',
          title: 'Previous day all-day event',
          startDate: '2026-04-30T00:00:00.000Z',
          endDate: '2026-05-01T00:00:00.000Z',
          allDay: true
        },
        {
          id: 'today',
          title: 'Today all-day event',
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-02T00:00:00.000Z',
          allDay: true
        }
      ], window, async id => `hash-${(JSON.parse(id) as [string, number])[0]}`, 'android');

      expect(events).toEqual([{
        id: 'hash-today',
        title: 'Today all-day event',
        startAt: localTodayStartUtc,
        endAt: localTomorrowStartUtc,
        location: null,
        allDay: true
      }]);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('does not apply Android all-day normalization to iOS events', async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      const window = getCalendarReadWindow(new Date('2026-05-01T12:00:00.000Z'));
      const events = await projectCalendarEvents([{
        id: 'today',
        title: 'Today all-day event',
        startDate: '2026-05-01T00:00:00.000Z',
        endDate: '2026-05-02T00:00:00.000Z',
        allDay: true
      }], window, async id => `hash-${(JSON.parse(id) as [string, number])[0]}`, 'ios');

      expect(events[0]?.startAt).toBe('2026-05-01T00:00:00.000Z');
      expect(events[0]?.endAt).toBe('2026-05-02T00:00:00.000Z');
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('drops malformed and out-of-window events, sorts, and caps at 100', async () => {
    const window = getCalendarReadWindow(new Date(2026, 4, 1, 12));
    const inRangeEvents = Array.from({ length: 102 }, (_, index) => ({
      id: `native-${index}`,
      title: `Event ${index}`,
      startDate: new Date(2026, 4, 1, 13),
      endDate: new Date(2026, 4, 1, 14)
    }));
    const events = await projectCalendarEvents([
      ...inRangeEvents,
      { id: 'ends-at-window-start', title: 'Outside before', startDate: new Date(2026, 3, 30, 23), endDate: window.startInclusive },
      { id: 'starts-at-window-end', title: 'Outside after', startDate: window.endExclusive, endDate: new Date(2026, 4, 5, 1) },
      { id: 'invalid', title: '', startDate: 'not-a-time', endDate: 'not-a-time' }
    ], window, async id => `hash-${(JSON.parse(id) as [string, number])[0]}`);

    expect(events).toHaveLength(100);
    expect(events[0]?.title).toBe('Event 0');
    expect(events[99]?.title).toBe('Event 99');
  });
});

describe('ContextCollector', () => {
  it('creates a schema-valid real ContextInput from granted sources', async () => {
    const calendarEvent = {
      id: 'evt_hash_001',
      title: 'Planning',
      startAt: '2026-05-01T13:00:00.000Z',
      endAt: '2026-05-01T14:00:00.000Z',
      location: 'Room 4'
    };
    const collector = new ContextCollector(
      new StubLocationSource({ status: 'granted', location }),
      new StubCalendarSource({ status: 'granted', events: [calendarEvent] }),
      new FixedClock()
    );

    const result = await collector.collect();
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a ready context');
    expect(ContextInputSchema.parse(result.input)).toEqual(result.input);
    expect(result.input).toMatchObject({
      mode: 'real',
      deliveryMode: 'proactive',
      capturedAt: fixedNow.toISOString(),
      location,
      calendar: [calendarEvent]
    });
  });

  it('keeps calendar permission denial as a valid empty calendar state', async () => {
    const collector = new ContextCollector(
      new StubLocationSource({ status: 'granted', location }),
      new StubCalendarSource({ status: 'denied' }),
      new FixedClock()
    );

    const result = await collector.collect();
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a ready context');
    expect(result.input.calendar).toEqual([]);
    expect(result.input.calendarStatus).toBe('denied');
    expect(result.permissions).toEqual({ location: 'granted', calendar: 'denied', steps: 'unavailable' });
    expect(ContextInputSchema.safeParse(result.input).success).toBe(true);
  });

  it('represents denied location without fabricating a schema-valid location', async () => {
    const collector = new ContextCollector(
      new StubLocationSource({ status: 'denied' }),
      new StubCalendarSource({ status: 'denied' }),
      new FixedClock()
    );

    const result = await collector.collect();
    expect(result).toEqual({ status: 'location-unavailable', location: 'denied', calendar: 'denied', steps: 'unavailable' });
  });

  it('maps source failures to unavailable states', async () => {
    const locationSource: LocationSource = { readCurrentLocation: async () => { throw new Error('native failure'); } };
    const calendarSource: CalendarSource = { readUpcomingEvents: async () => { throw new Error('native failure'); } };
    const collector = new ContextCollector(locationSource, calendarSource, new FixedClock());

    expect(await collector.collect()).toEqual({
      status: 'location-unavailable',
      location: 'unavailable',
      calendar: 'unavailable', steps: 'unavailable'
    });
  });

  it('does not return an invalid location as a usable context', async () => {
    const collector = new ContextCollector(
      new StubLocationSource({
        status: 'granted',
        location: { ...location, latitude: 91 }
      }),
      new StubCalendarSource({ status: 'unavailable' }),
      new FixedClock()
    );

    expect(await collector.collect()).toEqual({ status: 'invalid-context', location: 'granted', calendar: 'unavailable', steps: 'unavailable' });
  });

  it.each([9999, 10000, 10001])('combines numeric step evidence and the saved goal at %i', async steps => {
    const stepSource: StepSource = { getTodaySteps: async now => {
      expect(now).toBe(fixedNow);
      return { status: 'granted', steps, source: 'foreground-sensor', confidence: 'low' };
    } };
    const result = await new ContextCollector(
      new StubLocationSource({ status: 'granted', location }),
      new StubCalendarSource({ status: 'denied' }), new FixedClock(), stepSource
    ).collect(10000);
    if (result.status !== 'ready') throw new Error('Expected context');
    expect(result.input.activity).toEqual({ stepsToday: steps, stepGoal: 10000, stepGoalReached: steps >= 10000, stepSource: 'foreground-sensor', confidence: 'low' });
    expect(result.input.preferencesOverride).toBeUndefined();
    expect(result.input.scenarioTime).toBeUndefined();
    expect(result.permissions.steps).toBe('granted');
  });

  it.each(['denied', 'unavailable'] as const)('keeps %s steps unknown without claiming the goal', async status => {
    const stepSource: StepSource = { getTodaySteps: async () => ({ status }) };
    const result = await new ContextCollector(
      new StubLocationSource({ status: 'granted', location }),
      new StubCalendarSource({ status: 'granted', events: [] }), new FixedClock(), stepSource
    ).collect(10000);
    if (result.status !== 'ready') throw new Error('Expected context');
    expect(result.input.activity).toEqual({ stepsToday: null, stepGoal: 10000 });
    expect(result.permissions.steps).toBe(status);
  });

  it('preserves location and calendar when the step source fails', async () => {
    const stepSource: StepSource = { getTodaySteps: async () => { throw new Error('sensor unavailable'); } };
    const result = await new ContextCollector(
      new StubLocationSource({ status: 'granted', location }),
      new StubCalendarSource({ status: 'granted', events: [] }), new FixedClock(), stepSource
    ).collect();
    if (result.status !== 'ready') throw new Error('Expected context');
    expect(result.input.activity).toEqual({ stepsToday: null });
    expect(result.permissions.steps).toBe('unavailable');
  });

  it.each([-1, 200001, 1.5, Number.NaN])('ignores invalid step evidence %s without losing other sources', async steps => {
    const stepSource: StepSource = { getTodaySteps: async () => ({ status: 'granted', steps, source: 'ios-pedometer', confidence: 'high' }) };
    const result = await new ContextCollector(
      new StubLocationSource({ status: 'granted', location }),
      new StubCalendarSource({ status: 'denied' }), new FixedClock(), stepSource
    ).collect(10000);
    if (result.status !== 'ready') throw new Error('Expected context');
    expect(result.input.activity).toEqual({ stepsToday: null, stepGoal: 10000 });
    expect(result.permissions.steps).toBe('unavailable');
  });
});
