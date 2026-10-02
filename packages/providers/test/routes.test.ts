import { describe, expect, it, vi } from 'vitest';
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { RouteSummarySchema, providerResultSchema } from '@contextia/contracts';
import type { RouteInput } from '../src/ports/RouteProvider.js';
import { AmazonLocationRouteProvider, createAmazonLocationRouteProvider } from '../src/adapters/routes.js';
import type { AmazonLocationRoutesClient } from '../src/adapters/routes.js';

const input: RouteInput = {
  origin: { latitude: 35.6812, longitude: 139.7671 },
  destination: { latitude: 35.6586, longitude: 139.7454 },
  mode: 'transit', departAt: '2026-10-02T05:00:00.000Z'
};

function leg(type: string, travelMode: string, duration: number, departure: string, arrival: string) {
  return {
    Type: type, TravelMode: travelMode,
    [`${type}LegDetails`]: {
      Departure: { Time: departure }, Arrival: { Time: arrival },
      Summary: { Overview: { Duration: duration, Distance: duration * 5 } },
      ...(type === 'Transit' ? { Transport: { Mode: travelMode, RouteName: 'Example Line' } } : {}),
      Notices: []
    }
  };
}

function routeResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    Notices: [],
    Routes: [{
      Summary: { Duration: 1_800, Distance: 9_000 },
      Legs: [
        leg('Pedestrian', 'Pedestrian', 300, '2026-10-02T05:00:00Z', '2026-10-02T05:05:00Z'),
        leg('Transit', 'Subway', 1_200, '2026-10-02T05:05:00Z', '2026-10-02T05:25:00Z'),
        leg('Pedestrian', 'Pedestrian', 300, '2026-10-02T05:25:00Z', '2026-10-02T05:30:00Z')
      ]
    }],
    ...overrides
  };
}

function testProvider(payload: unknown = routeResponse(), options: { region?: string; timeoutMs?: number } = {}) {
  const calculateRoutes = vi.fn<AmazonLocationRoutesClient['calculateRoutes']>().mockResolvedValue(payload);
  return {
    provider: new AmazonLocationRouteProvider({
      client: { calculateRoutes }, region: options.region ?? 'ap-northeast-1', timeoutMs: options.timeoutMs ?? 50
    }),
    calculateRoutes
  };
}

describe('AmazonLocationRouteProvider guards', () => {
  it.each([
    { ...input, origin: { latitude: 91, longitude: 139 } },
    { ...input, mode: 'car' },
    { ...input, departAt: 'not-a-time' },
    { ...input, departAt: '2026-10-02T05:00:00' },
    { ...input, arriveBy: '2026-10-02T06:00:00Z' }
  ])('rejects invalid coordinates, mode, time, or competing planning times before calling AWS', async invalid => {
    const { provider, calculateRoutes } = testProvider();
    await expect(provider.getRoute(invalid as unknown as RouteInput))
      .resolves.toMatchObject({ status: 'error', data: null, code: 'INVALID_REQUEST' });
    expect(calculateRoutes).not.toHaveBeenCalled();
  });

  it.each(['transit', 'intermodal'] as const)('does not request %s in a documented unsupported region', async mode => {
    const { provider, calculateRoutes } = testProvider(routeResponse(), { region: 'ap-southeast-1' });
    await expect(provider.getRoute({ ...input, mode }))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'UNSUPPORTED_REGION' });
    expect(calculateRoutes).not.toHaveBeenCalled();
  });

  it('returns unavailable for no route and does not infer departure or arrival times', async () => {
    const { provider } = testProvider({ Routes: [], Notices: [] });
    await expect(provider.getRoute(input))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'NO_ROUTE' });
  });

  it.each([
    { Routes: [{ Summary: { Duration: -1 }, Legs: [] }] },
    { Routes: [{ Summary: { Duration: 600 }, Legs: [leg('Transit', 'Subway', 600, 'invalid', '2026-10-02T05:30:00Z')] }] },
    { Routes: [{ Summary: { Duration: 600 }, Legs: [leg('Transit', 'Subway', 600, '2026-10-02T05:30:00Z', '2026-10-02T05:20:00Z')] }] },
    { Routes: [{ Summary: { Duration: 600 }, Legs: [leg('Transit', 'Subway', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z'), leg('Pedestrian', 'Pedestrian', 600, '2026-10-02T05:05:00Z', '2026-10-02T05:15:00Z')] }] }
  ])('rejects malformed route facts and impossible schedules', async payload => {
    const { provider } = testProvider(payload);
    await expect(provider.getRoute(input))
      .resolves.toMatchObject({ status: 'error', data: null, code: 'INVALID_RESPONSE' });
  });

  it('returns unavailable when transit schedules are missing instead of adding duration to request time', async () => {
    const { provider } = testProvider({ Routes: [{
      Summary: { Duration: 600 },
      Legs: [{ Type: 'Transit', TravelMode: 'Subway', TransitLegDetails: {
        Summary: { Overview: { Duration: 600 } }, Transport: { Mode: 'Subway' }
      } }]
    }] });
    await expect(provider.getRoute(input))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'SCHEDULE_UNAVAILABLE' });
  });

  it('honors NoSchedule notices even if duration and time fields are supplied', async () => {
    const { provider } = testProvider(routeResponse({ Notices: [{ Code: 'NoSchedule', Impact: 'High' }] }));
    await expect(provider.getRoute(input))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'SCHEDULE_UNAVAILABLE' });
  });

  it('does not label a walking-only fallback as a transit route', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [
      leg('Pedestrian', 'Pedestrian', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z')
    ] }] });
    await expect(provider.getRoute(input))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'NO_TRANSIT_ROUTE' });
  });

  it('retains required transit attribution links from the selected route', async () => {
    const response = { Routes: [{ Summary: { Duration: 1_200 }, Legs: [{
      Type: 'Transit', TravelMode: 'Subway', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:20:00Z' },
        Summary: { Overview: { Duration: 1_200 } },
        Attributions: [{ AttributionType: 'Disclaimer', WebLink: {
          AnchorText: 'Transit terms', Description: 'Terms for this transit route', Url: 'https://example.com/terms'
        } }]
      }
    }] }] };
    const { provider } = testProvider(response);
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'ok', data: {
      attributions: [{ type: 'Disclaimer', text: 'Transit terms', url: 'https://example.com/terms' }]
    } });
  });

  it.each([['Transit', 'Subway'], ['Vehicle', 'Car'], ['Rental', 'Car'], ['Taxi', 'Car']])(
    'rejects a %s/%s leg returned for a pedestrian request', async (type, travelMode) => {
      const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [
        leg(type, travelMode, 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z')
      ] }] });
      await expect(provider.getRoute({ ...input, mode: 'pedestrian' }))
        .resolves.toMatchObject({ status: 'error', data: null, code: 'INVALID_RESPONSE' });
    }
  );

  it('keeps a vehicle-only transit response unavailable instead of accepting the wrong mode', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [
      leg('Vehicle', 'Car', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z')
    ] }] });
    await expect(provider.getRoute(input))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'NO_TRANSIT_ROUTE' });
  });

  it('connects the default factory to the current Routes SDK', async () => {
    const send = vi.spyOn(GeoRoutesClient.prototype, 'send').mockResolvedValue(routeResponse() as never);
    try {
      const provider = createAmazonLocationRouteProvider({ region: 'ap-northeast-1', timeoutMs: 50 });
      await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'ok' });
      expect(send).toHaveBeenCalledWith(expect.any(CalculateRoutesCommand), expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
      const command = send.mock.calls[0]?.[0] as CalculateRoutesCommand | undefined;
      expect(command?.input).toMatchObject({ Origin: [139.7671, 35.6812], Destination: [139.7454, 35.6586],
        TravelMode: 'Transit', DepartureTime: input.departAt });
    } finally { send.mockRestore(); }
  });

  it('rejects a returned departure earlier than the requested departure', async () => {
    const { provider } = testProvider();
    await expect(provider.getRoute({ ...input, departAt: '2026-10-02T05:00:01Z' }))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'PLANNING_TIME_UNSATISFIED' });
  });

  it('rejects a returned arrival later than the requested arrival deadline', async () => {
    const { provider } = testProvider();
    await expect(provider.getRoute({ origin: input.origin, destination: input.destination, mode: 'transit', arriveBy: '2026-10-02T05:29:59Z' }))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'PLANNING_TIME_UNSATISFIED' });
  });

  it.each(['Cancelled', 'Replaced'])('does not offer a transit schedule marked %s', async status => {
    const cancelled = leg('Transit', 'Subway', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z');
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      ...cancelled,
      TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z', Status: status },
        Arrival: { Time: '2026-10-02T05:10:00Z' }, Summary: { Overview: { Duration: 600 } }
      }
    }] }] });
    await expect(provider.getRoute(input))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'SCHEDULE_UNAVAILABLE' });
  });
});

describe('AmazonLocationRouteProvider normalization', () => {
  it('requests Routes V2 Transit with longitude first and an explicit departure time', async () => {
    const { provider, calculateRoutes } = testProvider();
    const result = await provider.getRoute(input);
    expect(calculateRoutes).toHaveBeenCalledWith({
      Origin: [139.7671, 35.6812], Destination: [139.7454, 35.6586],
      TravelMode: 'Transit', DepartureTime: input.departAt, LegAdditionalFeatures: ['Summary'], MaxAlternatives: 0
    }, expect.any(AbortSignal));
    expect(result).toMatchObject({ status: 'ok', data: {
      mode: 'transit', durationMinutes: 30, distanceMeters: 9_000,
      departAt: '2026-10-02T05:00:00Z', arriveAt: '2026-10-02T05:30:00Z', transfers: 0,
      legs: [{ mode: 'pedestrian', durationMinutes: 5 }, { mode: 'subway', durationMinutes: 20, lineName: 'Example Line' }, { mode: 'pedestrian', durationMinutes: 5 }],
      warnings: []
    } });
    expect(providerResultSchema(RouteSummarySchema).safeParse(result).success).toBe(true);
  });

  it('maps arrival-aware Intermodal requests and keeps non-transit legs without claiming a transit mode', async () => {
    const { provider, calculateRoutes } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [
      leg('Taxi', 'Car', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z')
    ] }] });
    const result = await provider.getRoute({ origin: input.origin, destination: input.destination, mode: 'intermodal', arriveBy: '2026-10-02T05:10:00Z' });
    expect(calculateRoutes).toHaveBeenCalledWith(expect.objectContaining({ TravelMode: 'Intermodal', ArrivalTime: '2026-10-02T05:10:00Z' }), expect.any(AbortSignal));
    expect(calculateRoutes.mock.calls[0]?.[0]).not.toHaveProperty('DepartureTime');
    expect(result).toMatchObject({ status: 'ok', data: { mode: 'intermodal', legs: [{ mode: 'other', durationMinutes: 10 }] } });
  });

  it('retains legal vehicle, transit and pedestrian legs for an intermodal request', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 1_800 }, Legs: [
      leg('Vehicle', 'Car', 300, '2026-10-02T05:00:00Z', '2026-10-02T05:05:00Z'),
      leg('Transit', 'Subway', 1_200, '2026-10-02T05:05:00Z', '2026-10-02T05:25:00Z'),
      leg('Pedestrian', 'Pedestrian', 300, '2026-10-02T05:25:00Z', '2026-10-02T05:30:00Z')
    ] }] });
    await expect(provider.getRoute({ ...input, mode: 'intermodal' })).resolves.toMatchObject({
      status: 'ok', data: { mode: 'intermodal', durationMinutes: 30, legs: [{ mode: 'other' }, { mode: 'subway' }, { mode: 'pedestrian' }] }
    });
  });

  it('uses DepartNow only when no planning timestamp is supplied', async () => {
    const { provider, calculateRoutes } = testProvider();
    await provider.getRoute({ origin: input.origin, destination: input.destination, mode: 'transit' });
    expect(calculateRoutes).toHaveBeenCalledWith(expect.objectContaining({ DepartNow: true }), expect.any(AbortSignal));
  });

  it('derives missing pedestrian duration only from the returned departure and arrival facts', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00Z' }
      }
    }] }] });
    await expect(provider.getRoute({ ...input, mode: 'pedestrian' }))
      .resolves.toMatchObject({ status: 'ok', data: { durationMinutes: 10, legs: [{ mode: 'pedestrian', durationMinutes: 10 }] } });
  });

  it('permits pedestrian duration data without inventing missing timestamps', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: { Summary: { Overview: { Duration: 600 } } }
    }] }] });
    const result = await provider.getRoute({ ...input, mode: 'pedestrian' });
    expect(result).toMatchObject({ status: 'ok', data: { durationMinutes: 10 } });
    expect(result.data).not.toHaveProperty('departAt');
    expect(result.data).not.toHaveProperty('arriveAt');
  });

  it('uses the provider timestamp span when a route summary has a different duration', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 300 }, Legs: [
      leg('Transit', 'Subway', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z')
    ] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({
      status: 'degraded', code: 'DURATION_MISMATCH', data: {
        durationMinutes: 10, warnings: ['DURATION_MISMATCH'], legs: [{ durationMinutes: 10 }]
      }
    });
  });

  it('accepts subsecond schedule rounding without understating the route or leg duration', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Transit', TravelMode: 'Subway', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00.000000001Z' },
        Arrival: { Time: '2026-10-02T05:10:00.500000001Z' },
        Summary: { TravelOnly: { Duration: 601 }, Overview: { Duration: 601 } }
      }
    }] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'degraded', data: {
      durationMinutes: 600.5 / 60, legs: [{ durationMinutes: 600.5 / 60 }]
    } });
  });

  it('rounds the complete schedule once instead of summing rounded travel and wait', async () => {
    const response = { Routes: [{ Summary: { Duration: 1_200 }, Legs: [
      { Type: 'Transit', TravelMode: 'Bus', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00.500000000Z' },
        Summary: { TravelOnly: { Duration: 600 }, Overview: { Duration: 600 } }
      } },
      { Type: 'Transit', TravelMode: 'CityTrain', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:10:01Z' }, Arrival: { Time: '2026-10-02T05:20:01Z' },
        Summary: { TravelOnly: { Duration: 600 }, Overview: { Duration: 600 } }
      } }
    ] }] };
    const { provider } = testProvider(response);
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'degraded', data: {
      durationMinutes: 1_201 / 60, legs: [{ durationMinutes: 600.5 / 60 }, { durationMinutes: 10 }]
    } });
  });

  it('checks the arrival deadline at nanosecond precision', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Transit', TravelMode: 'Subway', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00.000000002Z' },
        Summary: { TravelOnly: { Duration: 600 }, Overview: { Duration: 600 } }
      }
    }] }] });
    await expect(provider.getRoute({ origin: input.origin, destination: input.destination, mode: 'transit',
      arriveBy: '2026-10-02T05:10:00.000000001Z' }))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'PLANNING_TIME_UNSATISFIED' });
  });

  it.each([
    ['2026-10-02T05:14:59.5Z', 'unavailable'],
    ['2026-10-02T05:15:00Z', 'degraded']
  ] as const)('requires the transfer gap to fit all before/after steps at %s', async (secondDeparture, status) => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 1200 }, Legs: [
      { Type: 'Transit', TravelMode: 'Bus', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00Z' },
        Summary: { TravelOnly: { Duration: 600 }, Overview: { Duration: 900 } }, AfterTravelSteps: [{ Duration: 300 }]
      } },
      { Type: 'Transit', TravelMode: 'CityTrain', TransitLegDetails: {
        Departure: { Time: secondDeparture }, Arrival: { Time: '2026-10-02T05:25:00Z' },
        Summary: { TravelOnly: { Duration: 600 }, Overview: { Duration: 600 } }
      } }
    ] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status, ...(status === 'unavailable' ? { code: 'DURATION_UNRESOLVED', data: null } : { data: { durationMinutes: 25 } }) });
  });

  it.each([false, true])('rejects an overview exceeding the fractional schedule by more than integer rounding, travelSummary=%s', async includeTravel => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{ Type: 'Transit', TravelMode: 'Subway', TransitLegDetails: {
      Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00.5Z' },
      Summary: { ...(includeTravel ? { TravelOnly: { Duration: 601 } } : {}), Overview: { Duration: 602 } }
    } }] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'unavailable', code: 'DURATION_UNRESOLVED', data: null });
  });

  it('rejects an unexplained difference between the full leg duration and travel timestamps', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [
      leg('Vehicle', 'Car', 900, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z')
    ] }] });
    await expect(provider.getRoute({ ...input, mode: 'intermodal' })).resolves.toMatchObject({
      status: 'unavailable', data: null, code: 'DURATION_UNRESOLVED'
    });
  });

  it('uses the full unscheduled pedestrian leg duration when the route summary contains only travel time', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: {
        Summary: { Overview: { Duration: 900 }, TravelOnly: { Duration: 600 } },
        BeforeTravelSteps: [{ Duration: 120 }], AfterTravelSteps: [{ Duration: 180 }]
      }
    }] }] });
    const result = await provider.getRoute({ ...input, mode: 'pedestrian' });
    expect(result).toMatchObject({ status: 'degraded', code: 'DURATION_MISMATCH', data: {
      durationMinutes: 15, legs: [{ durationMinutes: 15 }], warnings: ['DURATION_MISMATCH']
    } });
    expect(result.data).not.toHaveProperty('departAt');
    expect(result.data).not.toHaveProperty('arriveAt');
  });

  it('preserves the reviewer\'s unscheduled 900-second overview instead of returning the 600-second route summary', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: {
        Summary: { Overview: { Duration: 900 } }
      }
    }] }] });
    await expect(provider.getRoute({ ...input, mode: 'pedestrian' })).resolves.toMatchObject({
      status: 'degraded', code: 'DURATION_MISMATCH', data: { durationMinutes: 15, legs: [{ durationMinutes: 15 }] }
    });
  });

  it('sums multiple unscheduled pedestrian overviews without adding their before/after steps twice', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 900 }, Legs: [
      { Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: {
        Summary: { Overview: { Duration: 900 }, TravelOnly: { Duration: 600 } },
        BeforeTravelSteps: [{ Duration: 120 }], AfterTravelSteps: [{ Duration: 180 }]
      } },
      { Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: {
        Summary: { Overview: { Duration: 300 }, TravelOnly: { Duration: 300 } }
      } }
    ] }] });
    await expect(provider.getRoute({ ...input, mode: 'pedestrian' })).resolves.toMatchObject({
      status: 'degraded', code: 'DURATION_MISMATCH', data: { durationMinutes: 20,
        legs: [{ durationMinutes: 15 }, { durationMinutes: 5 }] }
    });
  });

  it('includes transfer waiting once even when the route summary omits it', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 1_200 }, Legs: [
      leg('Transit', 'Bus', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z'),
      leg('Transit', 'CityTrain', 600, '2026-10-02T05:15:00Z', '2026-10-02T05:25:00Z')
    ] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'degraded', data: {
      durationMinutes: 25, transfers: 1, legs: [{ durationMinutes: 10 }, { durationMinutes: 10 }]
    } });
  });

  function routeWithTravelSteps(afterSeconds = 300, beforeSeconds = 120): unknown {
    return { Routes: [{ Summary: { Duration: 2_040 }, Legs: [
      { Type: 'Vehicle', TravelMode: 'Car', VehicleLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00Z' },
        Summary: { Overview: { Duration: 600 + afterSeconds }, TravelOnly: { Duration: 600 } },
        AfterTravelSteps: [{ Duration: afterSeconds }]
      } },
      leg('Pedestrian', 'Pedestrian', 300, '2026-10-02T05:15:00Z', '2026-10-02T05:20:00Z'),
      { Type: 'Transit', TravelMode: 'Subway', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:25:00Z' }, Arrival: { Time: '2026-10-02T05:35:00Z' },
        Summary: { Overview: { Duration: 660 + beforeSeconds }, TravelOnly: { Duration: 600 } },
        BeforeTravelSteps: [{ Duration: beforeSeconds }], AfterTravelSteps: [{ Duration: 60 }]
      } },
      leg('Pedestrian', 'Pedestrian', 300, '2026-10-02T05:37:00Z', '2026-10-02T05:42:00Z')
    ] }] };
  }

  it('reconciles before/after steps with scheduled gaps without double counting parking or boarding time', async () => {
    const { provider } = testProvider(routeWithTravelSteps());
    await expect(provider.getRoute({ ...input, mode: 'intermodal' })).resolves.toMatchObject({
      status: 'degraded', code: 'DURATION_MISMATCH', data: {
        durationMinutes: 42, departAt: '2026-10-02T05:00:00Z', arriveAt: '2026-10-02T05:42:00Z',
        legs: [{ durationMinutes: 15 }, { durationMinutes: 5 }, { durationMinutes: 13 }, { durationMinutes: 5 }]
      }
    });
  });

  it.each([[301, 120], [300, 301]])('rejects travel steps that cannot fit between scheduled legs', async (after, before) => {
    const { provider } = testProvider(routeWithTravelSteps(after, before));
    await expect(provider.getRoute({ ...input, mode: 'intermodal' })).resolves.toMatchObject({
      status: 'unavailable', data: null, code: 'DURATION_UNRESOLVED'
    });
  });

  it('rejects a gap where individually plausible after/before steps overlap each other', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 1_200 }, Legs: [
      { Type: 'Transit', TravelMode: 'Bus', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00Z' },
        Summary: { Overview: { Duration: 780 }, TravelOnly: { Duration: 600 } }, AfterTravelSteps: [{ Duration: 180 }]
      } },
      { Type: 'Transit', TravelMode: 'CityTrain', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:15:00Z' }, Arrival: { Time: '2026-10-02T05:25:00Z' },
        Summary: { Overview: { Duration: 780 }, TravelOnly: { Duration: 600 } }, BeforeTravelSteps: [{ Duration: 180 }]
      } }
    ] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'unavailable', data: null, code: 'DURATION_UNRESOLVED' });
  });

  it.each(['before', 'after'] as const)('does not invent a route boundary timestamp for an outer %s-travel step', async side => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Transit', TravelMode: 'Bus', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00Z' },
        Summary: { Overview: { Duration: 900 }, TravelOnly: { Duration: 600 } },
        ...(side === 'before' ? { BeforeTravelSteps: [{ Duration: 300 }] } : { AfterTravelSteps: [{ Duration: 300 }] })
      }
    }] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'unavailable', data: null, code: 'DURATION_UNRESOLVED' });
  });

  it.each([
    { Overview: { Duration: 599 }, TravelOnly: { Duration: 600 } },
    { Overview: { Duration: 600 }, TravelOnly: { Duration: 599 } }
  ])('rejects inconsistent overview, travel-only duration and scheduled travel', async summary => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Transit', TravelMode: 'Bus', TransitLegDetails: {
        Departure: { Time: '2026-10-02T05:00:00Z' }, Arrival: { Time: '2026-10-02T05:10:00Z' }, Summary: summary
      }
    }] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'unavailable', data: null, code: 'DURATION_UNRESOLVED' });
  });

  it('rejects an unexplained route summary longer than all confirmed elapsed time', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 601 }, Legs: [
      leg('Transit', 'Subway', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z')
    ] }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({ status: 'unavailable', data: null, code: 'DURATION_UNRESOLVED' });
  });

  it('rejects partially timed pedestrian legs rather than guessing the missing wait', async () => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 900 }, Legs: [
      leg('Pedestrian', 'Pedestrian', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z'),
      { Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: { Summary: { Overview: { Duration: 300 } } } }
    ] }] });
    await expect(provider.getRoute({ ...input, mode: 'pedestrian' })).resolves.toMatchObject({
      status: 'unavailable', data: null, code: 'DURATION_UNRESOLVED'
    });
  });

  it.each([{ Duration: -1 }, {}])('rejects malformed before/after durations instead of ignoring required time', async step => {
    const { provider } = testProvider({ Routes: [{ Summary: { Duration: 600 }, Legs: [{
      Type: 'Pedestrian', TravelMode: 'Pedestrian', PedestrianLegDetails: {
        Summary: { Overview: { Duration: 600 } }, AfterTravelSteps: [step]
      }
    }] }] });
    await expect(provider.getRoute({ ...input, mode: 'pedestrian' })).resolves.toMatchObject({
      status: 'error', data: null, code: 'INVALID_RESPONSE'
    });
  });

  it('compares arrival and departure boundaries by instant across timezone offsets', async () => {
    const { provider } = testProvider();
    await expect(provider.getRoute({ ...input, departAt: '2026-10-02T14:00:00+09:00' }))
      .resolves.toMatchObject({ status: 'ok' });
    await expect(provider.getRoute({ origin: input.origin, destination: input.destination, mode: 'transit', arriveBy: '2026-10-02T14:30:00+09:00' }))
      .resolves.toMatchObject({ status: 'ok' });
  });

  it('counts transfers between transit boardings and keeps warning codes', async () => {
    const { provider } = testProvider({ Notices: [{ Code: 'ScheduledTimes', Impact: 'Low' }], Routes: [{
      Summary: { Duration: 1_200 }, Legs: [
        leg('Transit', 'Bus', 600, '2026-10-02T05:00:00Z', '2026-10-02T05:10:00Z'),
        leg('Transit', 'CityTrain', 600, '2026-10-02T05:10:00Z', '2026-10-02T05:20:00Z')
      ]
    }] });
    await expect(provider.getRoute(input)).resolves.toMatchObject({
      status: 'degraded', code: 'ROUTE_NOTICES', data: { transfers: 1, warnings: ['ScheduledTimes'], legs: [{ mode: 'bus' }, { mode: 'rail' }] }
    });
  });

  it('creates stable route identifiers from normalized facts, changing them when the route changes', async () => {
    const first = testProvider();
    const second = testProvider();
    const third = testProvider({ Routes: [{ Summary: { Duration: 1_200 }, Legs: [
      leg('Transit', 'Subway', 1_200, '2026-10-02T05:00:00Z', '2026-10-02T05:20:00Z')
    ] }] });
    const firstResult = await first.provider.getRoute(input);
    const secondResult = await second.provider.getRoute(input);
    const thirdResult = await third.provider.getRoute(input);
    expect(firstResult.data?.routeId).toMatch(/^amazon-location-route:[a-f0-9]{32}$/);
    expect(firstResult.data?.routeId).toBe(secondResult.data?.routeId);
    expect(firstResult.data?.routeId).not.toBe(thirdResult.data?.routeId);
  });

  it('aborts timed out requests and sanitizes authentication and throttling failures', async () => {
    const calculateRoutes = vi.fn<AmazonLocationRoutesClient['calculateRoutes']>((_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('private upstream data')), { once: true });
    }));
    const timed = new AmazonLocationRouteProvider({ client: { calculateRoutes }, region: 'ap-northeast-1', timeoutMs: 2 });
    await expect(timed.getRoute(input)).resolves.toMatchObject({ status: 'timeout', data: null, code: 'TIMEOUT' });
    expect(calculateRoutes.mock.calls[0]?.[1].aborted).toBe(true);

    for (const [name, code] of [['AccessDeniedException', 'UPSTREAM_AUTH'], ['ThrottlingException', 'THROTTLED']]) {
      const failing = new AmazonLocationRouteProvider({
        client: { calculateRoutes: vi.fn().mockRejectedValue(Object.assign(new Error('private upstream data'), { name })) },
        region: 'ap-northeast-1', timeoutMs: 50
      });
      await expect(failing.getRoute(input)).resolves.toMatchObject({ status: 'error', data: null, code });
    }
  });
});
