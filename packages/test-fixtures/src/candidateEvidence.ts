import { CandidateEvidenceSchema } from '@contextia/contracts';
import type { CandidateEvidence, GeoPoint, ProviderResult, RouteSummary } from '@contextia/contracts';
import type { ScenarioFixture } from './types.js';

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}
function routeResult(result: ProviderResult<RouteSummary[]>, route: RouteSummary): ProviderResult<RouteSummary> {
  if (result.status !== 'ok' && result.status !== 'degraded') throw new Error('Expected usable synthetic routes');
  return {
    status: result.status, data: route,
    ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
    ...(result.code === undefined ? {} : { code: result.code })
  };
}

function routeFailure(result: ProviderResult<RouteSummary[]>): ProviderResult<RouteSummary> {
  const status = result.status;
  if (status === 'ok' || status === 'degraded') throw new Error('Expected unavailable synthetic routes');
  return { ...result, status, data: null };
}

// Tests only. Console presets continue to use getScenarioInput and never send these mock results.
export function getScenarioEvidence(fixture: ScenarioFixture): CandidateEvidence {
  const evidence: CandidateEvidence = { geocoding: [], places: [], weather: [], routes: [] };
  const now = Date.parse(fixture.context.scenarioTime ?? fixture.context.capturedAt);
  const event = [...fixture.context.calendar].filter(value => Date.parse(value.startAt) > now)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  const needs = new Set(fixture.providerNeeds);
  if (needs.has('geocode-event-location') && event) evidence.geocoding.push({ eventId: event.id, result: fixture.providers.geocoding });
  for (const need of ['places-near-current', 'places-near-destination'] as const) {
    if (needs.has(need) && (need === 'places-near-current' || event)) {
      evidence.places.push({ need, anchorKey: need === 'places-near-current' ? 'current' : event?.id ?? 'missing', result: fixture.providers.places });
    }
  }
  for (const need of ['weather-current', 'weather-today'] as const) {
    if (needs.has(need)) evidence.weather.push({ need, result: fixture.providers.weather });
  }
  const routes = fixture.providers.routes;
  if (needs.has('route-to-next-event') && event) {
    const planning = fixture.eventRouteArriveBy === undefined ? {} : { arriveBy: fixture.eventRouteArriveBy };
    if (routes.status === 'ok' || routes.status === 'degraded') {
      for (const route of routes.data) evidence.routes.push({ need: 'route-to-next-event', anchorKey: event.id, ...planning, result: routeResult(routes, route) });
    } else evidence.routes.push({ need: 'route-to-next-event', anchorKey: event.id, ...planning, result: routeFailure(routes) });
  }
  if (needs.has('route-to-place-candidates')) {
    const places = fixture.providers.places.data ?? [];
    if (routes.status === 'ok' || routes.status === 'degraded') {
      for (const route of routes.data) {
        const place = places.find(value => samePoint(value, route.origin) || samePoint(value, route.destination));
        if (!place) throw new Error('Synthetic activity route must reference a supplied place');
        evidence.routes.push({ need: 'route-to-place-candidates', anchorKey: place.placeId, result: routeResult(routes, route) });
      }
    } else {
      for (const place of places) evidence.routes.push({ need: 'route-to-place-candidates', anchorKey: place.placeId, result: routeFailure(routes) });
    }
  }
  return CandidateEvidenceSchema.parse(evidence);
}
