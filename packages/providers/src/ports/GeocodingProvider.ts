import type { GeocodedPlace, GeoPoint, PersistenceIntent, ProviderResult } from '@contextia/contracts';

export interface GeocodingInput {
  queryText: string;
  biasPosition?: GeoPoint;
  locale?: string;
  persistenceIntent: PersistenceIntent;
}
export interface GeocodingProvider {
  // Ambiguous/low-confidence matches return unavailable, not an arbitrary choice.
  geocode(input: GeocodingInput): Promise<ProviderResult<GeocodedPlace[]>>;
}
