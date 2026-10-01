import { describe, expect, it } from 'vitest';
import { earlyArrival, earlyArrivalFarAway, getScenarioEvidence } from '@contextia/test-fixtures';
import { GeocodedPlaceSchema } from '@contextia/contracts';
import { defaultDetectorPolicy, distanceMeters } from '../src/index.js';
import { primaryCandidates, refined } from './detectorHarness.js';

const event = earlyArrival.context.calendar[0];
if (!event) throw new Error('Early arrival fixture must contain an event');

describe('EARLY_ARRIVAL_DETOUR', () => {
  it('checks proximity and reserves time for a real round trip plus event buffer', async () => {
    expect((await primaryCandidates(earlyArrival))[0]?.providerNeeds).toEqual(earlyArrival.providerNeeds);
    const result = await refined(earlyArrival);
    expect(result.candidates[0]?.facts).toMatchObject({
      eventId: event.id, destinationDistanceMeters: 0, eligiblePlaceIds: ['synthetic-cafe-1'],
      returnDeadlineAt: '2026-10-01T06:50:00.000Z',
      placeTimeBudgets: [{ placeId: 'synthetic-cafe-1', outboundRouteId: 'early-out', returnRouteId: 'early-return', activityMinutes: 22 }]
    });
  });

  it('does not claim early arrival before geocoding or from a distant position', async () => {
    const missing = getScenarioEvidence(earlyArrival);
    missing.geocoding = [];
    expect((await refined(earlyArrival, {}, missing)).exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
    expect((await refined(earlyArrivalFarAway)).candidates).toEqual([]);
  });

  it.each([
    ['2026-10-01T15:30:00+09:00', 1],
    ['2026-10-01T15:30:00.001+09:00', 0],
    ['2026-10-01T16:00:00+09:00', 0]
  ])('checks the early-arrival time boundary at %s', async (scenarioTime, count) => {
    expect(await primaryCandidates(earlyArrival, { scenarioTime })).toHaveLength(count);
  });

  it.each([
    ['2026-10-01T15:27:00+09:00', 1],
    ['2026-10-01T15:27:00.001+09:00', 0]
  ])('excludes detours that exceed the return deadline at %s', async (scenarioTime, count) => {
    expect((await refined(earlyArrival, { scenarioTime })).candidates).toHaveLength(count);
  });

  it('does not use all-day, missing-location or conflicting-ID events as a destination', async () => {
    expect(await primaryCandidates(earlyArrival, { calendar: [{ ...event, allDay: true }] })).toEqual([]);
    expect(await primaryCandidates(earlyArrival, { calendar: [{ ...event, location: null }] })).toEqual([]);
    expect(await primaryCandidates(earlyArrival, { calendar: [event, { ...event, startAt: '2026-10-01T17:00:00+09:00', endAt: '2026-10-01T18:00:00+09:00' }] })).toEqual([]);
    expect(await primaryCandidates(earlyArrival, { calendar: [event, event] })).toHaveLength(1);
  });

  it('recognizes equivalent instants and trimmed locations for duplicate event IDs', async () => {
    const equivalent = {
      ...event, startAt: new Date(event.startAt).toISOString(), endAt: new Date(event.endAt).toISOString(),
      location: ` ${event.location ?? ''} `
    };
    expect(await primaryCandidates(earlyArrival, { calendar: [event, equivalent] })).toHaveLength(1);
    expect((await refined(earlyArrival, { calendar: [event, equivalent] })).candidates).toHaveLength(1);
  });

  it('excludes low-confidence or ambiguous geocoding per candidate', async () => {
    const evidence = getScenarioEvidence(earlyArrival);
    const destination = GeocodedPlaceSchema.parse(evidence.geocoding[0]?.result.data?.[0]);
    for (const data of [
      [{ ...destination, confidence: 0.799 }],
      [destination, { ...destination, placeId: 'another-destination', longitude: destination.longitude + 0.01 }]
    ]) {
      const altered = { ...evidence, geocoding: [{ eventId: event.id, result: { status: 'ok' as const, data } }] };
      expect((await refined(earlyArrival, {}, altered)).exclusions[0]?.code).toBe('GEOCODE_AMBIGUOUS');
    }
    const exact = { ...evidence, geocoding: [{ eventId: event.id, result: { status: 'degraded' as const, data: [{ ...destination, confidence: 0.8 }] } }] };
    expect((await refined(earlyArrival, {}, exact)).candidates).toHaveLength(1);
  });

  it('includes reported accuracy in the distance boundary', async () => {
    const location = { ...earlyArrival.context.location, latitude: earlyArrival.context.location.latitude + 0.0001 };
    const evidence = getScenarioEvidence(earlyArrival);
    const destination = GeocodedPlaceSchema.parse(evidence.geocoding[0]?.result.data?.[0]);
    const radius = distanceMeters(location, destination) + (location.accuracyMeters ?? 0);
    expect((await refined(earlyArrival, { location }, evidence, { ...defaultDetectorPolicy, earlyArrivalRadiusMeters: radius })).candidates).toHaveLength(1);
    expect((await refined(earlyArrival, { location }, evidence, { ...defaultDetectorPolicy, earlyArrivalRadiusMeters: radius - 0.001 })).candidates).toEqual([]);
  });

  it('does not attach places from an unrelated destination or invent return routes', async () => {
    const evidence = getScenarioEvidence(earlyArrival);
    evidence.places = evidence.places.map(entry => ({ ...entry, anchorKey: 'another-event' }));
    expect((await refined(earlyArrival, {}, evidence)).exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
    const oneWay = getScenarioEvidence(earlyArrival);
    oneWay.routes = oneWay.routes.filter(entry => entry.result.data?.routeId === 'early-out');
    expect((await refined(earlyArrival, {}, oneWay)).candidates).toEqual([]);
  });

  it('keeps a stable event anchor while lowering confidence for unknown accuracy', async () => {
    const location = { ...earlyArrival.context.location };
    delete location.accuracyMeters;
    expect((await refined(earlyArrival, { location })).candidates[0]?.confidence).toBeLessThanOrEqual(0.5);
    expect((await primaryCandidates(earlyArrival))[0]?.anchorKey).toBe(event.id);
    expect(await primaryCandidates(earlyArrival)).toEqual(await primaryCandidates(earlyArrival));
  });
});
