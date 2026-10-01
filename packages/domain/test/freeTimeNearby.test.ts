import { describe, expect, it } from 'vitest';
import { freeTime, freeTimeShortGap, getScenarioEvidence } from '@contextia/test-fixtures';
import { primaryCandidates, refined, changeRoutes } from './detectorHarness.js';

const event = freeTime.context.calendar[0];
if (!event) throw new Error('Free time fixture must contain an event');

describe('FREE_TIME_NEARBY', () => {
  it('fits an activity and both actual journeys before the next event buffer', async () => {
    expect((await primaryCandidates(freeTime))[0]?.providerNeeds).toEqual(freeTime.providerNeeds);
    const result = await refined(freeTime);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.facts).toMatchObject({
      availableMinutes: 110, nextEventId: event.id, eligiblePlaceIds: ['synthetic-cafe-1'],
      returnDeadlineAt: '2026-10-01T06:50:00.000Z',
      placeTimeBudgets: [{ placeId: 'synthetic-cafe-1', outboundRouteId: 'free-out', returnRouteId: 'free-return', activityMinutes: 92 }]
    });
  });

  it('rejects a short gap and an event currently in progress', async () => {
    expect(await primaryCandidates(freeTimeShortGap)).toEqual([]);
    expect(await primaryCandidates(freeTime, { calendar: [
      event, { ...event, id: 'busy', startAt: '2026-10-01T14:00:00+09:00', endAt: '2026-10-01T15:00:00+09:00' }
    ] })).toEqual([]);
  });

  it('treats an all-day interval as occupied without mutating the schedule', async () => {
    const calendar = [{ ...event, allDay: true, startAt: '2026-10-01T00:00:00+09:00', endAt: '2026-10-02T00:00:00+09:00' }];
    const before = structuredClone(calendar);
    expect(await primaryCandidates(freeTime, { calendar })).toEqual([]);
    expect(calendar).toEqual(before);
  });

  it.each([
    ['2026-10-01T15:30:00+09:00', 1],
    ['2026-10-01T15:30:00.001+09:00', 0]
  ])('checks the minimum gap boundary at %s', async (scenarioTime, count) => {
    expect(await primaryCandidates(freeTime, { scenarioTime })).toHaveLength(count);
  });

  it.each([
    ['2026-10-01T15:27:00+09:00', 1],
    ['2026-10-01T15:27:00.001+09:00', 0]
  ])('accounts for activity, outbound and return duration at %s', async (scenarioTime, count) => {
    expect((await refined(freeTime, { scenarioTime })).candidates).toHaveLength(count);
  });

  it('sorts multiple events and anchors the same gap independently of current minute', async () => {
    const past = { ...event, id: 'previous', startAt: '2026-10-01T12:00:00+09:00', endAt: '2026-10-01T13:00:00+09:00' };
    const later = { ...event, id: 'later', startAt: '2026-10-01T18:00:00+09:00', endAt: '2026-10-01T19:00:00+09:00' };
    const calendar = [later, past, event];
    const first = await primaryCandidates(freeTime, { calendar });
    const next = await primaryCandidates(freeTime, { calendar, scenarioTime: '2026-10-01T14:11:00+09:00' });
    expect(first[0]?.anchorKey).toBe(next[0]?.anchorKey);
    expect(first[0]?.facts.nextEventId).toBe(event.id);
    expect(calendar.map(value => value.id)).toEqual(['later', 'previous', event.id]);
  });

  it('bounds an open-ended gap and requires a return to the current position', async () => {
    const result = await refined(freeTime, { calendar: [] });
    expect(result.candidates[0]?.facts).toMatchObject({ availableMinutes: 120, nextEventId: null });
    expect(result.candidates[0]?.providerNeeds).not.toContain('geocode-event-location');
  });

  it('does not reverse an outward route or assume an unknown return duration', async () => {
    const evidence = getScenarioEvidence(freeTime);
    evidence.routes = evidence.routes.filter(entry => entry.result.data?.routeId === 'free-out');
    expect((await refined(freeTime, {}, evidence)).exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not reuse one route for both directions when endpoints are within the matching tolerance', async () => {
    const evidence = getScenarioEvidence(freeTime);
    const position = { latitude: freeTime.context.location.latitude + 0.00005, longitude: freeTime.context.location.longitude };
    evidence.places = evidence.places.map(entry => entry.result.status === 'ok' || entry.result.status === 'degraded'
      ? { ...entry, result: { ...entry.result, data: entry.result.data.map(place => ({ ...place, ...position, distanceMeters: 6 })) } } : entry);
    const outward = changeRoutes(evidence, route => ({ ...route, destination: position }));
    outward.routes = outward.routes.filter(entry => entry.result.data?.routeId === 'free-out');
    outward.routes.push(...structuredClone(outward.routes));
    const result = await refined(freeTime, {}, outward);
    expect(result.candidates).toEqual([]);
    expect(result.exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('keeps gap anchors distinct for opaque IDs containing separators or sentinel-like values', async () => {
    const past = { ...event, startAt: '2026-10-01T12:00:00+09:00', endAt: '2026-10-01T13:00:00+09:00' };
    const first = await primaryCandidates(freeTime, { calendar: [{ ...past, id: 'previous:segment' }, { ...event, id: 'next' }] });
    const second = await primaryCandidates(freeTime, { calendar: [{ ...past, id: 'previous' }, { ...event, id: 'segment:next' }] });
    expect(first[0]?.anchorKey).not.toBe(second[0]?.anchorKey);
    const open = await primaryCandidates(freeTime, { calendar: [] });
    const reserved = await primaryCandidates(freeTime, { calendar: [{ ...event, id: 'open' }] });
    expect(open[0]?.anchorKey).not.toBe(reserved[0]?.anchorKey);
  });

  it('excludes empty/closed places and activities that exceed their time budget', async () => {
    const empty = getScenarioEvidence(freeTime);
    empty.places = empty.places.map(entry => ({ ...entry, result: { status: 'ok', data: [] } }));
    expect((await refined(freeTime, {}, empty)).candidates).toEqual([]);
    const slow = changeRoutes(getScenarioEvidence(freeTime), route => ({ ...route, durationMinutes: 90 }));
    expect((await refined(freeTime, {}, slow)).candidates).toEqual([]);
    const closed = getScenarioEvidence(freeTime);
    closed.places = closed.places.map(entry => entry.result.status === 'ok' || entry.result.status === 'degraded'
      ? { ...entry, result: { ...entry.result, data: entry.result.data.map(place => ({ ...place, isOpen: false })) } } : entry);
    expect((await refined(freeTime, {}, closed)).candidates).toEqual([]);
  });

  it('keeps a valid free-time candidate when optional weather fails', async () => {
    const evidence = getScenarioEvidence(freeTime);
    evidence.weather = [{ need: 'weather-current', result: { status: 'timeout', data: null } }];
    expect((await refined(freeTime, {}, evidence)).candidates).toHaveLength(1);
  });

  it('checks the departure of a scheduled return after the minimum activity', async () => {
    const evidence = changeRoutes(getScenarioEvidence(freeTime), route => route.routeId === 'free-return'
      ? { ...route, mode: 'transit', departAt: '2026-10-01T14:29:00+09:00', arriveAt: '2026-10-01T14:33:00+09:00' } : route);
    expect((await refined(freeTime, {}, evidence)).candidates).toHaveLength(1);
    expect((await refined(freeTime, { scenarioTime: '2026-10-01T14:10:00.001+09:00' }, evidence)).candidates).toEqual([]);
    const unscheduled = changeRoutes(evidence, route => {
      const value = { ...route };
      if (value.mode === 'transit') { delete value.departAt; delete value.arriveAt; }
      return value;
    });
    expect((await refined(freeTime, {}, unscheduled)).candidates).toEqual([]);
  });
});
