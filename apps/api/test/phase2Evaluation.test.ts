import { describe, expect, it, vi } from 'vitest';
import { EvaluationResultSchema } from '@contextia/contracts';
import type { NotifyDecision, RecommendationItem } from '@contextia/contracts';
import type { GeocodingProvider, PlacesProvider, RecommendationModel, RouteProvider, WeatherProvider } from '@contextia/providers';
import { scenarios } from '@contextia/test-fixtures';
import type { ScenarioFixture } from '@contextia/test-fixtures';
import { phase2Detectors } from '@contextia/domain';
import { createEvaluateContext, defaultEvaluationPolicy } from '../src/application/evaluateContext.js';
import { createEvaluationDomain } from '../src/composition/evaluationDomain.js';
import { publicPlace, publicRoute } from '../src/application/references.js';
import { createRequestHandler } from '../src/handler.js';
import { NOW, ok, repository } from './support/repository.js';

const samePoint = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => a.latitude === b.latitude && a.longitude === b.longitude;

function setup(fixture: ScenarioFixture, primaryOnly = false) {
  const state = repository();
  state.getProfile.mockResolvedValue(ok({ userId: 'user-1', preferences: fixture.preferences }));
  const order: string[] = [];
  let storageFailure = false;
  const places: PlacesProvider = {
    searchNearby: vi.fn<PlacesProvider['searchNearby']>(async () => { order.push('places'); return fixture.providers.places; }),
    async getPlace(input) {
      order.push('storage');
      if (storageFailure) return { status: 'error', data: null };
      const place = fixture.providers.places.data?.find(value => value.placeId === input.placeId);
      return place ? ok({ persistenceIntent: input.persistenceIntent, place }) : { status: 'unavailable', data: null };
    }
  };
  const geocoding = { geocode: vi.fn<GeocodingProvider['geocode']>(async () => { order.push('geocode'); return fixture.providers.geocoding; }) };
  const weather = { getWeather: vi.fn<WeatherProvider['getWeather']>(async () => fixture.providers.weather) };
  const routes = { getRoute: vi.fn<RouteProvider['getRoute']>(async input => {
    order.push('route');
    const route = fixture.providers.routes.data?.find(value => value.mode === input.mode && samePoint(value.origin, input.origin) && samePoint(value.destination, input.destination));
    return route ? ok(route) : { status: 'unavailable', data: null, code: 'NO_COVERAGE' };
  }) };
  const model = { decide: vi.fn<RecommendationModel['decide']>(async input => {
    order.push('model');
    const candidate = input.candidates[0];
    if (!candidate) throw new Error('No adopted candidate');
    const place = input.enrichment.places.flatMap(entry => entry.result.data ?? [])[0];
    const route = input.enrichment.routes.flatMap(entry => entry.result.data ? [entry.result.data] : [])[0];
    const item: RecommendationItem = candidate.type === 'UPCOMING_EVENT_TRANSIT' && route
      ? { title: 'Leave for the event', reason: 'Supplied transit.', route: publicRoute(route), action: { type: 'TRANSIT' } }
      : { title: 'Contextual option', reason: 'Supplied place.', place: place ? publicPlace(place) : null, action: { type: place ? 'MAP' : 'NONE' } };
    const decision: NotifyDecision = {
      decision: 'notify', decisionReason: 'Useful provider facts.', urgency: 'low', message: 'An option for this moment.',
      recommendations: [item], usedSignals: candidate.requiredSignals
    };
    return ok(decision);
  }) };
  let sequence = 0;
  const domain = createEvaluationDomain(primaryOnly ? { detectors: phase2Detectors.filter(value => value.type === fixture.primaryTrigger) } : {});
  const evaluate = createEvaluateContext({ state, idempotency: state, places, geocoding, weather, routes, model, domain, clock: () => NOW, newId: prefix => `${prefix}-${++sequence}` });
  return { state, places, geocoding, weather, routes, model, evaluate, order, failStorage: () => { storageFailure = true; } };
}

describe('Phase 2: five fixtures through the same evaluation pipeline', () => {
  it.each(['weather', 'routes'] as const)('forces only %s for this preview and leaves the next request unchanged', async demoFault => {
    const fixture = scenarios.find(value => value.id === 'free-time');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, weather, routes, model } = setup(fixture);
    const context = { ...fixture.context, activity: { ...fixture.context.activity, stepsToday: 12_000 } };
    const result = await evaluate({ userId: 'user-1', context, demoFault });
    expect(result).toMatchObject({ decision: 'notify', triggerType: 'STEP_GOAL_REST', providerStatus: { [demoFault]: { status: 'unavailable', code: 'DEMO_FORCED_UNAVAILABLE' } } });
    if (demoFault === 'weather') {
      expect(weather.getWeather).not.toHaveBeenCalled();
      expect(result.weather).toBeNull();
    } else {
      expect(routes.getRoute).not.toHaveBeenCalled();
      expect(model.decide.mock.calls[0]?.[0].enrichment.routes).toEqual([]);
    }
    const next = await evaluate({ userId: 'user-1', context });
    expect(['ok', 'degraded']).toContain(next.providerStatus[demoFault].status);
    expect(demoFault === 'weather' ? weather.getWeather : routes.getRoute).toHaveBeenCalled();
  });

  it('does not force a provider call when the chosen scenario does not need it', async () => {
    const fixture = scenarios.find(value => value.id === 'step-goal');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, routes } = setup(fixture, true);
    expect((await evaluate({ userId: 'user-1', context: fixture.context, demoFault: 'routes' })).providerStatus.routes.status).toBe('not_requested');
    expect(routes.getRoute).not.toHaveBeenCalled();
  });
  it('returns covered forecast facts rather than projecting a current observation into a simulation', async () => {
    const fixture = scenarios.find(value => value.id === 'weather-adaptation');
    if (!fixture?.providers.weather.data) throw new Error('Missing weather fixture');
    const { evaluate, weather } = setup(fixture, true);
    weather.getWeather.mockResolvedValue(ok({ ...fixture.providers.weather.data, temperatureCelsius: 40,
      forecast: fixture.providers.weather.data.forecast.map(value => ({ ...value, temperatureCelsius: null })) }));
    const result = await evaluate({ userId: 'user-1', context: { ...fixture.context, scenarioTime: '2026-10-01T15:30:00+09:00' } });
    expect(result).toMatchObject({ weather: { source: 'forecast', temperatureCelsius: null, startAt: '2026-10-01T15:00:00+09:00', endAt: '2026-10-01T16:00:00+09:00' } });
    expect(result.weather).not.toHaveProperty('forecast');
    const outside = await evaluate({ userId: 'user-1', context: { ...fixture.context, scenarioTime: '2026-10-01T16:00:00+09:00' } });
    expect(outside.weather).toBeNull();
  });

  it('preserves an independent step-goal recommendation when weather is unavailable', async () => {
    const fixture = scenarios.find(value => value.id === 'free-time');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, weather } = setup(fixture);
    weather.getWeather.mockResolvedValue({ status: 'unavailable', data: null });
    const result = await evaluate({ userId: 'user-1', context: { ...fixture.context, activity: { ...fixture.context.activity, stepsToday: 12_000 } } });
    expect(result).toMatchObject({ decision: 'notify', triggerType: 'STEP_GOAL_REST', weather: null,
      providerStatus: { weather: { status: 'unavailable' }, places: { status: 'ok' } } });
  });
  it.each(scenarios)('$id uses validated provider evidence and reports its adopted trigger', async fixture => {
    const { evaluate, model, state } = setup(fixture, true);
    const result = await evaluate({ userId: 'user-1', context: fixture.context });
    expect(EvaluationResultSchema.parse(result)).toMatchObject({ decision: 'notify', triggerType: fixture.primaryTrigger, delivery: { mode: 'preview', status: 'preview' } });
    expect(model.decide).toHaveBeenCalledOnce();
    expect(model.decide.mock.calls[0]?.[0].candidates).toHaveLength(1);
    expect(model.decide.mock.calls[0]?.[0].now).toBe(new Date(fixture.context.scenarioTime ?? fixture.context.capturedAt).toISOString());
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
    expect(state.commitProactiveRecommendation).not.toHaveBeenCalled();
    expect(state.writeRecommendation).toHaveBeenCalledOnce();
  });

  it.each(scenarios)('$id keeps full-registry selection, model input and persisted trigger consistent', async fixture => {
    const { evaluate, model, state } = setup(fixture);
    const result = EvaluationResultSchema.parse(await evaluate({ userId: 'user-1', context: fixture.context }));
    expect(result.decision).toBe('notify');
    expect(result.triggerType).toBe(model.decide.mock.calls[0]?.[0].candidates[0]?.type);
    expect(state.writeRecommendation.mock.calls[0]?.[0].recommendation.triggerType).toBe(result.triggerType);
  });

  it('deduplicates the shared destination, current/destination Places and both activity routes', async () => {
    const fixture = scenarios.find(value => value.id === 'early-arrival');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, places, routes, geocoding, weather, order } = setup(fixture);
    await evaluate({ userId: 'user-1', context: fixture.context });
    expect(geocoding.geocode).toHaveBeenCalledOnce();
    expect(places.searchNearby).toHaveBeenCalledOnce();
    expect(weather.getWeather).toHaveBeenCalledOnce();
    // One event route plus two distinct activity directions; free-time and early-arrival share calls.
    expect(routes.getRoute).toHaveBeenCalledTimes(3);
    expect(order.indexOf('geocode')).toBeLessThan(order.indexOf('route'));
    expect(order.indexOf('places')).toBeLessThan(order.indexOf('route'));
    expect(order.lastIndexOf('route')).toBeLessThan(order.indexOf('model'));
    expect(routes.getRoute.mock.calls.some(([input]) => 'departAt' in input)).toBe(true);
    expect(routes.getRoute.mock.calls.some(([input]) => 'arriveBy' in input)).toBe(true);
  });

  it('drops the transit candidate when routing fails and continues the step-goal candidate', async () => {
    const fixture = scenarios.find(value => value.id === 'free-time');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, model, routes } = setup(fixture);
    routes.getRoute.mockResolvedValue({ status: 'timeout', data: null });
    const result = await evaluate({ userId: 'user-1', context: { ...fixture.context, activity: { ...fixture.context.activity, stepsToday: 12_000 } } });
    expect(result).toMatchObject({ decision: 'notify', triggerType: 'STEP_GOAL_REST', providerStatus: { routes: { status: 'timeout' }, places: { status: 'ok' } } });
    expect(model.decide.mock.calls[0]?.[0].candidates[0]?.type).toBe('STEP_GOAL_REST');
    expect(model.decide.mock.calls[0]?.[0].enrichment.routes).toEqual([]);
  });

  it('does not call Bedrock when the required geocode is ambiguous', async () => {
    const fixture = scenarios.find(value => value.id === 'upcoming-transit');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, geocoding, routes, model } = setup(fixture, true);
    const first = fixture.providers.geocoding.data?.[0];
    if (!first) throw new Error('Missing destination');
    geocoding.geocode.mockResolvedValue(ok([first, { ...first, placeId: 'different-match' }]));
    const result = await evaluate({ userId: 'user-1', context: fixture.context });
    expect(result).toMatchObject({ decision: 'silent', providerStatus: { geocoding: { status: 'unavailable', code: 'GEOCODE_AMBIGUOUS' }, bedrock: { status: 'not_requested' } } });
    expect(routes.getRoute).not.toHaveBeenCalled();
    expect(model.decide).not.toHaveBeenCalled();
  });

  it('does not consume proactive quota if selected Storage retrieval fails', async () => {
    const fixture = scenarios.find(value => value.id === 'step-goal');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, failStorage, state } = setup(fixture, true);
    failStorage();
    const context = { ...fixture.context, mode: 'real' as const, deliveryMode: 'proactive' as const, location: { ...fixture.context.location, source: 'gps' as const } };
    expect(await evaluate({ userId: 'user-1', context })).toMatchObject({ decision: 'silent', providerStatus: { places: { code: 'PLACE_STORAGE_UNAVAILABLE' } } });
    expect(state.commitProactiveRecommendation).not.toHaveBeenCalled();
    expect(state.writeRecommendation).not.toHaveBeenCalled();
  });

  it('turns an empty-code atomic concurrency rejection into a safe failure', async () => {
    const fixture = scenarios.find(value => value.id === 'step-goal');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, state } = setup(fixture, true);
    state.commitProactiveRecommendation.mockResolvedValue(ok({ recorded: false, guardCodes: [] }));
    await expect(evaluate({ userId: 'user-1', context: { ...fixture.context, mode: 'real', deliveryMode: 'proactive', location: { ...fixture.context.location, source: 'gps' } } })).rejects.toMatchObject({ code: 'STATE_UNAVAILABLE' });
  });

  it('returns 409 and releases the claim when the transaction explicitly reports a superseded evaluation', async () => {
    const fixture = scenarios.find(value => value.id === 'step-goal');
    if (!fixture) throw new Error('Missing fixture');
    const { evaluate, state, model } = setup(fixture, true);
    state.commitProactiveRecommendation.mockResolvedValue(ok({ recorded: false, guardCodes: [], reason: 'superseded' }));
    const context = { ...fixture.context, mode: 'real', deliveryMode: 'proactive', location: { ...fixture.context.location, source: 'gps' } };
    const handle = createRequestHandler({ version: 'test', log: vi.fn(), clients: { webClientId: 'web', mobileClientId: 'mobile' }, evaluate });
    const response = await handle({ method: 'POST', path: '/v1/context/evaluate', requestId: 'req-conflict', claims: { sub: 'user-1', clientId: 'mobile' },
      body: JSON.stringify(context), idempotencyKey: '1b055bc1-60ee-4f8a-9c80-39427850be5e' });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'EVALUATION_SUPERSEDED' } });
    expect(state.releaseIdempotency).toHaveBeenCalledOnce();
    expect(state.completeIdempotency).not.toHaveBeenCalled();
    expect(model.decide).toHaveBeenCalledOnce();
  });

  it('uses the specified 1km/30-place discovery bound', () => {
    expect(defaultEvaluationPolicy).toMatchObject({ nearbyRadiusMeters: 1000, nearbyMaxResults: 30 });
  });
});
