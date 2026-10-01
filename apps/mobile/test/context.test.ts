import { CalendarEventContextSchema, ContextInputSchema, type LocationContext } from '@contextia/contracts';
import { describe, expect, it } from 'vitest';
import { getCalendarReadWindow } from '../src/context/calendarWindow';
import { projectCalendarEvents } from '../src/context/calendarProjection';
import { ContextCollector } from '../src/context/contextCollector';
import type { CalendarReadResult, CalendarSource, ClockSource, LocationReadResult, LocationSource } from '../src/context/types';

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
    ], window, async id => `hash-${id}`);

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
    expect(result.permissions).toEqual({ location: 'granted', calendar: 'denied' });
    expect(ContextInputSchema.safeParse(result.input).success).toBe(true);
  });

  it('represents denied location without fabricating a schema-valid location', async () => {
    const collector = new ContextCollector(
      new StubLocationSource({ status: 'denied' }),
      new StubCalendarSource({ status: 'denied' }),
      new FixedClock()
    );

    const result = await collector.collect();
    expect(result).toEqual({ status: 'location-unavailable', location: 'denied', calendar: 'denied' });
  });

  it('maps source failures to unavailable states', async () => {
    const locationSource: LocationSource = { readCurrentLocation: async () => { throw new Error('native failure'); } };
    const calendarSource: CalendarSource = { readUpcomingEvents: async () => { throw new Error('native failure'); } };
    const collector = new ContextCollector(locationSource, calendarSource, new FixedClock());

    expect(await collector.collect()).toEqual({
      status: 'location-unavailable',
      location: 'unavailable',
      calendar: 'unavailable'
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

    expect(await collector.collect()).toEqual({ status: 'invalid-context', location: 'granted', calendar: 'unavailable' });
  });
});
