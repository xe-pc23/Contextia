import { describe, expect, it, vi } from 'vitest';
import type { CandidateOpportunity, ProviderResult, RouteSummary } from '@contextia/contracts';
import type { PlacesProvider, RouteProvider } from '@contextia/providers';
import { freeTime, getScenarioInput, upcomingTransit } from '@contextia/test-fixtures';
import { enrichCandidates } from '../src/application/enrichCandidates.js';
import { defaultEvaluationPolicy } from '../src/application/evaluateContext.js';
import { NOW, ok, place, preferences } from './support/repository.js';

const context = { ...getScenarioInput('free-time'), calendar: [] };
const candidate: CandidateOpportunity = { type: 'FREE_TIME_NEARBY', confidence: 0.75, anchorKey: 'gap', requiredSignals: ['location'],
  providerNeeds: ['places-near-current', 'route-to-place-candidates'], facts: {} };
const pool = Array.from({ length: 10 }, (_, index) => ({ ...place, placeId: `place-${index}`, latitude: place.latitude + index * 0.0001, distanceMeters: index * 10, isOpen: true }));
function places(): PlacesProvider {
  return { searchNearby: vi.fn(async () => ok(pool)), getPlace: vi.fn() };
}
describe('provider orchestration bounds', () => {
  it('does not apply current-only opening status to a simulated time or omit its route fanout', async () => {
    const currentClosed = { ...place, isOpen: false };
    const provider: PlacesProvider = { searchNearby: vi.fn(async () => ok([currentClosed])), getPlace: vi.fn() };
    const routes = { getRoute: vi.fn<RouteProvider['getRoute']>(async () => ({ status: 'unavailable', data: null })) };
    const simulated = await enrichCandidates({ context, evaluationAt: NOW, preferences, candidates: [candidate], providers: { places: provider, routes }, policy: defaultEvaluationPolicy });
    expect(simulated.enrichment.places[0]?.result.data?.[0]).not.toHaveProperty('isOpen');
    expect(routes.getRoute).toHaveBeenCalled();
    routes.getRoute.mockClear();
    const real = await enrichCandidates({ context: { ...context, mode: 'real', deliveryMode: 'proactive' }, evaluationAt: NOW, preferences, candidates: [candidate], providers: { places: provider, routes }, policy: defaultEvaluationPolicy });
    expect(real.enrichment.places[0]?.result.data?.[0]?.isOpen).toBe(false);
    expect(routes.getRoute).not.toHaveBeenCalled();
    expect(currentClosed.isOpen).toBe(false);
  });
  it('uses the transit candidate planning deadline and records the actual route request', async () => {
    const event = upcomingTransit.context.calendar[0];
    if (!event) throw new Error('upcoming-transit fixture needs an event');
    const fixtureRoute = upcomingTransit.providers.routes.data?.[0];
    if (!fixtureRoute) throw new Error('upcoming-transit fixture needs a route');
    const routeArriveBy = '2026-10-01T15:47:00+09:00';
    const transitCandidate: CandidateOpportunity = {
      type: 'UPCOMING_EVENT_TRANSIT', confidence: 1, anchorKey: event.id,
      requiredSignals: ['time', 'location', 'calendar', 'transit'],
      providerNeeds: ['geocode-event-location', 'route-to-next-event'],
      facts: { eventId: event.id, routeArriveBy }
    };
    const routes = { getRoute: vi.fn<RouteProvider['getRoute']>(async () => ok(fixtureRoute)) };
    const result = await enrichCandidates({ context: upcomingTransit.context,
      evaluationAt: new Date(upcomingTransit.context.scenarioTime ?? upcomingTransit.context.capturedAt), preferences: upcomingTransit.preferences,
      candidates: [transitCandidate], providers: {
        places: places(), routes, geocoding: { geocode: vi.fn(async () => upcomingTransit.providers.geocoding) }
      }, policy: defaultEvaluationPolicy });
    expect(routes.getRoute).toHaveBeenCalledWith(expect.objectContaining({ arriveBy: routeArriveBy }));
    expect(result.enrichment.routes[0]?.arriveBy).toBe(routeArriveBy);
  });
  it('uses the activity candidate return deadline for the journey to the next event', async () => {
    const event = freeTime.context.calendar[0];
    if (!event) throw new Error('free-time fixture needs an event');
    const returnDeadlineAt = '2026-10-01T15:42:00+09:00';
    const activityCandidate: CandidateOpportunity = {
      type: 'FREE_TIME_NEARBY', confidence: 0.75, anchorKey: 'gap',
      requiredSignals: ['time', 'location', 'calendar', 'places', 'preferences'],
      providerNeeds: ['places-near-current', 'route-to-place-candidates', 'geocode-event-location'],
      facts: { nextEventId: event.id, activityDeadlineAt: returnDeadlineAt, returnDeadlineAt }
    };
    const routes = { getRoute: vi.fn<RouteProvider['getRoute']>(async () => ({ status: 'unavailable', data: null })) };
    await enrichCandidates({ context: freeTime.context,
      evaluationAt: new Date(freeTime.context.scenarioTime ?? freeTime.context.capturedAt), preferences: freeTime.preferences,
      candidates: [activityCandidate], providers: {
        places: { searchNearby: vi.fn(async () => freeTime.providers.places), getPlace: vi.fn() },
        routes, geocoding: { geocode: vi.fn(async () => freeTime.providers.geocoding) }
      }, policy: defaultEvaluationPolicy });
    expect(routes.getRoute).toHaveBeenCalledWith(expect.objectContaining({ arriveBy: new Date(returnDeadlineAt).toISOString() }));
  });
  it('limits route places and concurrent calls while retaining both travel directions', async () => {
    let running = 0; let maximum = 0; let sequence = 0;
    const routes = { getRoute: vi.fn<RouteProvider['getRoute']>(async request => {
      running++; maximum = Math.max(maximum, running);
      await new Promise(resolve => setTimeout(resolve, 2)); running--;
      return ok({ routeId: `route-${++sequence}`, mode: request.mode, durationMinutes: 1,
        origin: request.origin, destination: request.destination, legs: [], warnings: [] });
    }) };
    const result = await enrichCandidates({ context, evaluationAt: NOW, preferences, candidates: [candidate, candidate],
      providers: { places: places(), routes }, policy: { ...defaultEvaluationPolicy, maxRoutePlaces: 3, routeConcurrency: 2 } });
    expect(routes.getRoute).toHaveBeenCalledTimes(6);
    expect(maximum).toBeLessThanOrEqual(2);
    expect(result.enrichment.routes).toHaveLength(6);
    expect(result.providerStatus.routes.status).toBe('ok');
  });
  it('ends a hanging fan-out at the shared deadline and does not start later provider calls', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const routes = { getRoute: vi.fn<RouteProvider['getRoute']>(() => new Promise<ProviderResult<RouteSummary>>(() => {})) };
      const pending = enrichCandidates({ context, evaluationAt: NOW, preferences, candidates: [candidate],
        providers: { places: places(), routes }, policy: { ...defaultEvaluationPolicy, routesTimeoutMs: 100, enrichmentTimeoutMs: 20, maxRoutePlaces: 6, routeConcurrency: 2 } });
      await vi.advanceTimersByTimeAsync(21);
      const result = await pending;
      expect(routes.getRoute).toHaveBeenCalledTimes(2);
      expect(result.providerStatus.routes.status).toBe('timeout');
      expect(result.enrichment.routes.some(entry => entry.result.code === 'EVALUATION_DEADLINE')).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
