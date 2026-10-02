import type { z } from 'zod';
import {
  CandidateEvidenceSchema, GeocodedPlaceSchema, ProviderPlaceSchema, RouteSummarySchema,
  WeatherSnapshotSchema, providerResultSchema
} from '@contextia/contracts';
import type {
  CalendarEventContext, CandidateOpportunity, ContextInput, GeocodedPlace, GeoPoint,
  ProviderResult, ProviderStatusMap, UserPreferences
} from '@contextia/contracts';
import { defaultDetectorPolicy, distanceMeters } from '@contextia/domain';
import type {
  GeocodingProvider, PlacesProvider, ProviderEnrichment, RouteInput, RouteProvider, WeatherProvider
} from '@contextia/providers';
import { mergeStatus, providerCall } from './providerCall.js';

export interface EnrichmentPolicy {
  nearbyRadiusMeters: number; nearbyMaxResults: number;
  placesTimeoutMs: number; weatherTimeoutMs: number; routesTimeoutMs: number;
  enrichmentTimeoutMs: number; maxRoutePlaces: number; routeConcurrency: number;
  eventRouteMode: 'transit' | 'intermodal';
}
export interface EnrichmentProviders {
  places: PlacesProvider; geocoding?: GeocodingProvider; weather?: WeatherProvider; routes?: RouteProvider;
}

function eventIds(candidate: CandidateOpportunity, calendar: CalendarEventContext[]): string[] {
  const ids = [candidate.facts.eventId, candidate.facts.nextEventId, candidate.anchorKey];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && calendar.some(event => event.id === id)))];
}

function uniqueDestination(result: ProviderResult<GeocodedPlace[]>): GeoPoint | undefined {
  if (!result.data) return undefined;
  const eligible = result.data.filter(place => place.confidence >= defaultDetectorPolicy.minimumGeocodeConfidence);
  const ids = new Set(eligible.map(place => place.placeId));
  const first = eligible[0];
  if (ids.size !== 1 || !first || eligible.some(place => distanceMeters(first, place) > 1)) return undefined;
  return { latitude: first.latitude, longitude: first.longitude };
}

async function concurrent<T>(values: readonly T[], count: number, run: (value: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, values.length) }, async () => {
    while (next < values.length) {
      const value = values[next++];
      if (value !== undefined) await run(value);
    }
  }));
}

export async function enrichCandidates(input: {
  context: ContextInput; evaluationAt: Date; preferences: UserPreferences;
  candidates: CandidateOpportunity[]; providers: EnrichmentProviders; policy: EnrichmentPolicy;
}): Promise<{ enrichment: ProviderEnrichment; providerStatus: ProviderStatusMap }> {
  const { context, evaluationAt, preferences, candidates, providers, policy } = input;
  const enrichment: ProviderEnrichment = { geocoding: [], places: [], weather: [], routes: [] };
  const needs = new Set(candidates.flatMap(candidate => candidate.providerNeeds));
  const point = { latitude: context.location.latitude, longitude: context.location.longitude };
  const deadline = performance.now() + policy.enrichmentTimeoutMs;
  const remaining = (timeout: number) => Math.max(1, Math.min(timeout, deadline - performance.now()));
  async function call<T>(run: (() => Promise<ProviderResult<T>>) | undefined, schema: z.ZodType<T>, timeout: number): Promise<ProviderResult<T>> {
    if (!run) return { status: 'unavailable', data: null, code: 'PROVIDER_NOT_CONNECTED' };
    if (performance.now() >= deadline) return { status: 'timeout', data: null, code: 'EVALUATION_DEADLINE' };
    const result = await providerCall(run, remaining(timeout));
    const parsed = providerResultSchema(schema).safeParse(result);
    return parsed.success ? parsed.data : { status: 'error', data: null, code: 'INVALID_PROVIDER_DATA' };
  }
  const geocodeCalls = new Map<string, Promise<ProviderResult<GeocodedPlace[]>>>();
  const nearbyCalls = new Map<string, ReturnType<PlacesProvider['searchNearby']>>();
  const routeCalls = new Map<string, ReturnType<RouteProvider['getRoute']>>();
  const weatherNeeds = (['weather-current', 'weather-today'] as const).filter(need => needs.has(need));
  const events = context.calendar.filter(event => event.location?.trim() && candidates.some(candidate =>
    candidate.providerNeeds.includes('geocode-event-location') && eventIds(candidate, context.calendar).includes(event.id)));
  const uniqueEvents = [...new Map(events.map(event => [event.id, event])).values()];
  const nearby = (position: GeoPoint) => {
    const request = { position, radiusMeters: policy.nearbyRadiusMeters, maxResults: policy.nearbyMaxResults, locale: preferences.locale, persistenceIntent: 'single-use' as const };
    const key = JSON.stringify(request);
    let pending = nearbyCalls.get(key);
    if (!pending) {
      pending = call(() => providers.places.searchNearby(request), ProviderPlaceSchema.array(), policy.placesTimeoutMs).then(result => {
        if (context.mode !== 'simulation' || !result.data) return result;
        // Amazon Location OpenNow describes the provider request's current time, not scenarioTime.
        // Keep simulated opening hours unknown rather than excluding or promising future availability.
        return { ...result, data: result.data.map(place => { const scoped = { ...place }; delete scoped.isOpen; return scoped; }) };
      });
      nearbyCalls.set(key, pending);
    }
    return pending;
  };
  const route = (request: RouteInput) => {
    const key = JSON.stringify(request);
    let pending = routeCalls.get(key);
    if (!pending) {
      pending = call(providers.routes ? () => providers.routes!.getRoute(request) : undefined, RouteSummarySchema, policy.routesTimeoutMs);
      routeCalls.set(key, pending);
    }
    return pending;
  };

  // Independent first-wave calls; the same current weather supports both logical needs.
  await Promise.all([
    needs.has('places-near-current') ? nearby(point).then(result => { enrichment.places.push({ need: 'places-near-current', anchorKey: 'current', result }); }) : Promise.resolve(),
    weatherNeeds.length ? call(providers.weather ? () => providers.weather!.getWeather({ position: point, at: evaluationAt.toISOString(), timezone: preferences.timezone }) : undefined,
      WeatherSnapshotSchema, policy.weatherTimeoutMs).then(result => { for (const need of weatherNeeds) enrichment.weather.push({ need, result }); }) : Promise.resolve(),
    ...uniqueEvents.map(async event => {
      const request = { queryText: event.location?.trim() ?? '', biasPosition: point, locale: preferences.locale, persistenceIntent: 'single-use' as const };
      const key = JSON.stringify(request);
      let pending = geocodeCalls.get(key);
      if (!pending) {
        pending = call(providers.geocoding ? () => providers.geocoding!.geocode(request) : undefined, GeocodedPlaceSchema.array(), policy.placesTimeoutMs);
        geocodeCalls.set(key, pending);
      }
      const result = await pending;
      enrichment.geocoding.push({ eventId: event.id, result: result.data && !uniqueDestination(result)
        ? { status: 'unavailable', data: null, code: 'GEOCODE_AMBIGUOUS', ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }) } : result });
    })
  ]);

  const destinations = new Map(enrichment.geocoding.flatMap(entry => {
    const destination = uniqueDestination(entry.result);
    return destination ? [[entry.eventId, destination] as const] : [];
  }));
  await Promise.all(uniqueEvents.flatMap(event => {
    const destination = destinations.get(event.id);
    if (!destination) return [];
    const relevant = candidates.filter(candidate => eventIds(candidate, context.calendar).includes(event.id));
    const calls: Promise<void>[] = [];
    if (relevant.some(candidate => candidate.providerNeeds.includes('places-near-destination'))) {
      calls.push(nearby(destination).then(result => { enrichment.places.push({ need: 'places-near-destination', anchorKey: event.id, result }); }));
    }
    const transitCandidate = relevant.find(candidate => candidate.providerNeeds.includes('route-to-next-event'));
    if (transitCandidate) {
      const arriveBy = typeof transitCandidate.facts.routeArriveBy === 'string'
        ? transitCandidate.facts.routeArriveBy
        : new Date(Date.parse(event.startAt) - defaultDetectorPolicy.arrivalBufferMinutes * 60_000).toISOString();
      calls.push(route({ origin: point, destination, mode: policy.eventRouteMode, arriveBy })
        .then(result => { enrichment.routes.push({ need: 'route-to-next-event', anchorKey: event.id, arriveBy, result }); }));
    }
    return calls;
  }));

  const activityCandidates = candidates.filter(candidate => candidate.providerNeeds.includes('route-to-place-candidates'));
  const tasks = activityCandidates.flatMap(candidate => {
    const eventId = eventIds(candidate, context.calendar)[0];
    const event = context.calendar.find(value => value.id === eventId);
    const early = candidate.type === 'EARLY_ARRIVAL_DETOUR';
    const need = early ? 'places-near-destination' : 'places-near-current';
    const anchor = early ? eventId : 'current';
    const entries = enrichment.places.filter(entry => entry.need === need && entry.anchorKey === anchor);
    const pool = [...new Map(entries.flatMap(entry => entry.result.data ?? []).filter(place => place.isOpen !== false).map(place => [place.placeId, place])).values()]
      .sort((a, b) => Number(b.isOpen === true) - Number(a.isOpen === true) || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
      .slice(0, policy.maxRoutePlaces);
    const target = event?.location?.trim() ? destinations.get(event.id) : point;
    const fallbackEnd = Math.min(evaluationAt.getTime() + defaultDetectorPolicy.maximumFreeTimeMinutes * 60_000,
      event ? Date.parse(event.startAt) : Infinity) - (event ? defaultDetectorPolicy.arrivalBufferMinutes * 60_000 : 0);
    const end = typeof candidate.facts.returnDeadlineAt === 'string'
      ? Date.parse(candidate.facts.returnDeadlineAt) : fallbackEnd;
    return pool.map(place => ({ place, target, deadline: new Date(end).toISOString() }));
  });
  const uniqueTasks = [...new Map(tasks.map(task => [JSON.stringify([task.place.placeId, task.target, task.deadline]), task])).values()];
  await concurrent(uniqueTasks, policy.routeConcurrency, async ({ place, target, deadline: arriveBy }) => {
    const position = { latitude: place.latitude, longitude: place.longitude };
    const outward = await route({ origin: point, destination: position, mode: 'pedestrian', departAt: evaluationAt.toISOString() });
    enrichment.routes.push({ need: 'route-to-place-candidates', anchorKey: place.placeId, result: outward });
    if (target) {
      const returning = await route({ origin: position, destination: target, mode: 'pedestrian', arriveBy });
      enrichment.routes.push({ need: 'route-to-place-candidates', anchorKey: place.placeId, arriveBy, result: returning });
    }
  });

  // Missing dependency results are explicit diagnostics, never invented destination coordinates.
  const missingDependency: ProviderResult<never> = { status: 'unavailable', data: null, code: 'DESTINATION_UNAVAILABLE' };
  const providerStatus: ProviderStatusMap = {
    geocoding: mergeStatus(enrichment.geocoding.map(entry => entry.result)),
    places: mergeStatus([...enrichment.places.map(entry => entry.result), ...(needs.has('places-near-destination') && !enrichment.places.some(entry => entry.need === 'places-near-destination') ? [missingDependency] : [])]),
    weather: mergeStatus(enrichment.weather.map(entry => entry.result)),
    routes: mergeStatus([...enrichment.routes.map(entry => entry.result), ...((needs.has('route-to-next-event') && !enrichment.routes.some(entry => entry.need === 'route-to-next-event'))
      || (needs.has('route-to-place-candidates') && !enrichment.routes.some(entry => entry.need === 'route-to-place-candidates')) ? [missingDependency] : [])]),
    bedrock: { status: 'not_requested' }
  };
  return { enrichment: CandidateEvidenceSchema.parse(enrichment), providerStatus };
}
