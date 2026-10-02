import { describe, expect, it, vi } from 'vitest';
import type { CandidateOpportunity, ProviderResult, RouteSummary } from '@contextia/contracts';
import type { PlacesProvider, RouteProvider } from '@contextia/providers';
import { getScenarioInput } from '@contextia/test-fixtures';
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
