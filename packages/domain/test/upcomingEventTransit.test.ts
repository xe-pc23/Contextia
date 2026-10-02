import { describe, expect, it } from 'vitest';
import { getScenarioEvidence, upcomingTransit, upcomingTransitNoLocation, upcomingTransitUnavailable } from '@contextia/test-fixtures';
import { defaultDetectorPolicy } from '../src/index.js';
import { changeRoutes, primaryCandidates, refined } from './detectorHarness.js';

const event = upcomingTransit.context.calendar[0];
if (!event) throw new Error('Upcoming fixture must contain an event');

function scheduledEvidence(schedules: readonly { routeId: string; departAt: string; arriveAt: string }[]) {
  const evidence = getScenarioEvidence(upcomingTransit);
  const entry = evidence.routes[0];
  if (!entry || (entry.result.status !== 'ok' && entry.result.status !== 'degraded')) throw new Error('Expected transit fixture');
  const result = entry.result;
  evidence.routes = schedules.map(schedule => ({
    ...entry, result: { ...result, data: {
      ...result.data, ...schedule,
      durationMinutes: (Date.parse(schedule.arriveAt) - Date.parse(schedule.departAt)) / 60_000
    } }
  }));
  return evidence;
}

const earlyJourney = { routeId: 'early', departAt: '2026-10-01T15:10:00+09:00', arriveAt: '2026-10-01T15:44:00+09:00' };
const latestJourney = { routeId: 'latest', departAt: '2026-10-01T15:30:00+09:00', arriveAt: '2026-10-01T15:44:00+09:00' };

describe('UPCOMING_EVENT_TRANSIT', () => {
  it('requires real geocoding/transit and considers the supplied departure', async () => {
    const seeds = await primaryCandidates(upcomingTransit);
    expect(seeds[0]).toMatchObject({
      type: upcomingTransit.primaryTrigger, anchorKey: event.id, providerNeeds: upcomingTransit.providerNeeds,
      requiredSignals: ['time', 'location', 'calendar', 'transit']
    });
    const result = await refined(upcomingTransit);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.facts).toMatchObject({
      eventId: event.id, routeId: 'synthetic-route-1', routeDurationMinutes: 34,
      providerDepartAt: '2026-10-01T15:10:00+09:00', providerArriveAt: '2026-10-01T15:44:00+09:00',
      departureSource: 'provider'
    });
  });

  it('rejects the missing-location fixture', async () => {
    expect(await primaryCandidates(upcomingTransitNoLocation)).toEqual([]);
  });

  it.each([null, '', '   '])('does not geocode an absent location %s', async location => {
    expect(await primaryCandidates(upcomingTransit, { calendar: [{ ...event, location }] })).toEqual([]);
  });

  it('ignores all-day and already started events', async () => {
    expect(await primaryCandidates(upcomingTransit, { calendar: [{ ...event, allDay: true }] })).toEqual([]);
    for (const scenarioTime of ['2026-10-01T16:00:00+09:00', '2026-10-01T16:00:00.001+09:00']) {
      expect(await primaryCandidates(upcomingTransit, { scenarioTime })).toEqual([]);
    }
  });

  it.each([
    ['2026-10-01T13:00:00+09:00', 1],
    ['2026-10-01T12:59:59.999+09:00', 0]
  ])('bounds enrichment at the event horizon: %s', async (scenarioTime, count) => {
    expect(await primaryCandidates(upcomingTransit, { scenarioTime })).toHaveLength(count);
  });

  it.each([
    ['2026-10-01T14:59:59.999+09:00', 0],
    ['2026-10-01T15:00:00+09:00', 1],
    ['2026-10-01T15:10:00+09:00', 1],
    ['2026-10-01T15:10:00.001+09:00', 0]
  ])('checks the leave-soon window using provider time: %s', async (scenarioTime, count) => {
    expect((await refined(upcomingTransit, { scenarioTime })).candidates).toHaveLength(count);
  });

  it.each([false, true])('waits for the latest feasible departure before applying leave-soon, reversed=%s', async reverse => {
    const schedules = [earlyJourney, latestJourney];
    const evidence = scheduledEvidence(reverse ? schedules.toReversed() : schedules);
    expect((await refined(upcomingTransit, {}, evidence)).candidates).toEqual([]);
  });

  it.each([false, true])('selects the latest departure within the lead window independently of route order, reversed=%s', async reverse => {
    const schedules = [earlyJourney, { ...latestJourney, departAt: '2026-10-01T15:12:00+09:00' }];
    const result = await refined(upcomingTransit, {}, scheduledEvidence(reverse ? schedules.toReversed() : schedules));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.facts).toMatchObject({ routeId: 'latest', latestDepartureAt: '2026-10-01T06:12:00.000Z' });
  });

  it.each([false, true])('breaks equal-departure ties consistently instead of using provider order, reversed=%s', async reverse => {
    const schedules = [{ ...earlyJourney, routeId: 'a' }, { ...earlyJourney, routeId: 'b' }];
    const result = await refined(upcomingTransit, {}, scheduledEvidence(reverse ? schedules.toReversed() : schedules));
    expect(result.candidates[0]?.facts).toMatchObject({ routeId: 'a', latestDepartureAt: '2026-10-01T06:10:00.000Z' });
  });

  it('excludes a later route that misses the arrival buffer before choosing the departure', async () => {
    const evidence = scheduledEvidence([earlyJourney, { ...latestJourney, arriveAt: '2026-10-01T15:50:00.001+09:00' }]);
    expect((await refined(upcomingTransit, {}, evidence)).candidates[0]?.facts).toMatchObject({
      routeId: 'early', latestDepartureAt: '2026-10-01T06:10:00.000Z'
    });
  });

  it.each([
    ['2026-10-01T15:19:59.999+09:00', 0],
    ['2026-10-01T15:20:00+09:00', 1],
    ['2026-10-01T15:30:00+09:00', 1],
    ['2026-10-01T15:30:00.001+09:00', 0]
  ])('applies the lead and elapsed-departure boundaries to the latest feasible route at %s', async (scenarioTime, count) => {
    const result = await refined(upcomingTransit, { scenarioTime }, scheduledEvidence([earlyJourney, latestJourney]));
    expect(result.candidates).toHaveLength(count);
    if (count) expect(result.candidates[0]?.facts.latestDepartureAt).toBe('2026-10-01T06:30:00.000Z');
  });

  it('compares supplied duration budgets with scheduled routes before applying the lead window', async () => {
    const evidence = scheduledEvidence([earlyJourney]);
    const entry = evidence.routes[0];
    if (!entry || entry.result.status !== 'ok') throw new Error('Expected transit fixture');
    const durationOnly = { ...entry.result.data, routeId: 'duration-only', durationMinutes: 20 };
    delete durationOnly.departAt;
    delete durationOnly.arriveAt;
    evidence.routes.push({ ...entry, result: { status: 'ok', data: durationOnly } });
    expect((await refined(upcomingTransit, {}, evidence)).candidates).toEqual([]);
    const result = await refined(upcomingTransit, { scenarioTime: '2026-10-01T15:20:00+09:00' }, evidence);
    expect(result.candidates[0]?.facts).toMatchObject({
      routeId: 'duration-only', departureSource: 'duration-budget', latestDepartureAt: '2026-10-01T06:30:00.000Z'
    });
    expect(result.candidates[0]?.facts).not.toHaveProperty('providerDepartAt');
  });

  it('leaves other candidates eligible when public transit is unavailable', async () => {
    const result = await refined(upcomingTransitUnavailable);
    expect(result.candidates).toEqual([]);
    expect(result.exclusions).toEqual([{ type: 'UPCOMING_EVENT_TRANSIT', anchorKey: event.id, code: 'PROVIDER_UNAVAILABLE' }]);
  });

  it('does not use a pedestrian route as proof of transit coverage', async () => {
    const evidence = changeRoutes(getScenarioEvidence(upcomingTransit), route => ({ ...route, mode: 'pedestrian' }));
    expect((await refined(upcomingTransit, {}, evidence)).exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('can calculate a departure budget from a supplied duration without inventing a timetable', async () => {
    const evidence = changeRoutes(getScenarioEvidence(upcomingTransit), route => {
      const result = { ...route };
      delete result.departAt;
      delete result.arriveAt;
      return result;
    });
    const result = await refined(upcomingTransit, {}, evidence);
    expect(result.candidates[0]?.facts).toMatchObject({ latestDepartureAt: '2026-10-01T06:16:00.000Z', departureSource: 'duration-budget' });
    expect(result.candidates[0]?.facts).not.toHaveProperty('providerDepartAt');
  });

  it('derives an absent departure from the supplied arrival, keeping its provenance', async () => {
    const evidence = changeRoutes(getScenarioEvidence(upcomingTransit), route => {
      const result = { ...route };
      delete result.departAt;
      return result;
    });
    const result = await refined(upcomingTransit, {}, evidence);
    expect(result.candidates[0]?.facts).toMatchObject({
      latestDepartureAt: '2026-10-01T06:10:00.000Z', departureSource: 'duration-budget',
      providerArriveAt: '2026-10-01T15:44:00+09:00'
    });
    expect(result.candidates[0]?.facts).not.toHaveProperty('providerDepartAt');
    expect((await refined(upcomingTransit, { scenarioTime: '2026-10-01T15:10:00.001+09:00' }, evidence)).candidates).toEqual([]);
  });

  it('rejects subsecond inconsistencies in provider travel time', async () => {
    const short = changeRoutes(getScenarioEvidence(upcomingTransit), route => ({
      ...route, arriveAt: '2026-10-01T15:43:59.999+09:00'
    }));
    expect((await refined(upcomingTransit, {}, short)).candidates).toEqual([]);
    const reversed = changeRoutes(getScenarioEvidence(upcomingTransit), route => ({
      ...route, durationMinutes: 0, arriveAt: '2026-10-01T15:09:59.999+09:00'
    }));
    expect((await refined(upcomingTransit, {}, reversed)).candidates).toEqual([]);
  });

  it('preserves the arrival buffer and rejects contradictory provider timestamps', async () => {
    for (const arriveAt of ['2026-10-01T15:50:00.001+09:00', '2026-10-01T15:05:00+09:00']) {
      const evidence = changeRoutes(getScenarioEvidence(upcomingTransit), route => ({ ...route, arriveAt }));
      expect((await refined(upcomingTransit, {}, evidence)).candidates).toEqual([]);
    }
  });

  it('uses an injected policy and stable event anchors on repeated detection', async () => {
    const policy = { ...defaultDetectorPolicy, departureLeadMinutes: 5 };
    expect((await refined(upcomingTransit, { scenarioTime: '2026-10-01T15:00:00+09:00' }, getScenarioEvidence(upcomingTransit), policy)).candidates).toEqual([]);
    expect(await primaryCandidates(upcomingTransit)).toEqual(await primaryCandidates(upcomingTransit));
  });

  it('does not attach routes belonging to another event or destination', async () => {
    const evidence = getScenarioEvidence(upcomingTransit);
    evidence.routes = evidence.routes.map(entry => ({ ...entry, anchorKey: 'unrelated-event' }));
    expect((await refined(upcomingTransit, {}, evidence)).exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
    const wrongDestination = changeRoutes(getScenarioEvidence(upcomingTransit), route => ({ ...route, destination: { latitude: 0, longitude: 0 } }));
    expect((await refined(upcomingTransit, {}, wrongDestination)).candidates).toEqual([]);
  });
});
