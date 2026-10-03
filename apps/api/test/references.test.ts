import { describe, expect, it } from 'vitest';
import type { RecommendationItem } from '@contextia/contracts';
import type { ProviderEnrichment } from '@contextia/providers';
import { upcomingTransit } from '@contextia/test-fixtures';
import { publicPlace, referenceError, suppliedPlaces } from '../src/application/references.js';

describe('model reference validation', () => {
  it('rejects a valid route paired with the wrong valid place, including saved follow-up cards', () => {
    const first = { provider: 'amazon-location' as const, placeId: 'a', name: 'A', latitude: 35, longitude: 139 };
    const second = { ...first, placeId: 'b', name: 'B', longitude: 139.01 };
    const route = { routeId: 'ra', origin: first, destination: first, mode: 'pedestrian' as const, durationMinutes: 4, legs: [], warnings: [] };
    const enrichment: ProviderEnrichment = { geocoding: [], weather: [], places: [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'ok', data: [first, second] } }],
      routes: [{ need: 'route-to-place-candidates', anchorKey: first.placeId, result: { status: 'ok', data: route } }] };
    const good: RecommendationItem = { title: 'A', reason: 'Supplied', place: first, route: { mode: 'pedestrian', durationMinutes: 4 }, action: { type: 'MAP' } };
    const wrong = { ...good, place: second };
    expect(referenceError([good], enrichment)).toBeNull();
    expect(referenceError([wrong], enrichment)).toBe('UNKNOWN_ROUTE_REFERENCE');
    expect(referenceError([wrong], { ...enrichment, routes: [] }, [good])).toBe('UNKNOWN_ROUTE_REFERENCE');
    expect(referenceError([good], { ...enrichment, routes: [] }, [good])).toBeNull();
  });
  it('accepts a confident geocoded destination supplied to the model', () => {
    const destination = upcomingTransit.providers.geocoding.data?.[0];
    if (!destination) throw new Error('Transit fixture needs a destination');
    const enrichment: ProviderEnrichment = {
      geocoding: [{ eventId: 'event-1', result: upcomingTransit.providers.geocoding }],
      places: [], weather: [], routes: []
    };
    const item: RecommendationItem = { title: 'Destination', reason: 'Supplied event destination',
      place: publicPlace(destination), action: { type: 'MAP' } };
    expect(suppliedPlaces(enrichment).has(destination.placeId)).toBe(true);
    expect(referenceError([item], enrichment)).toBeNull();
  });
});
