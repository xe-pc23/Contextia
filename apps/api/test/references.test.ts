import { describe, expect, it } from 'vitest';
import type { RecommendationItem } from '@contextia/contracts';
import type { ProviderEnrichment } from '@contextia/providers';
import { upcomingTransit } from '@contextia/test-fixtures';
import { publicPlace, referenceError, suppliedPlaces } from '../src/application/references.js';

describe('model reference validation', () => {
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
