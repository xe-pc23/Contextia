import type { GeoPoint, PersistenceIntent, ProviderPlace, ProviderResult } from '@contextia/contracts';

export interface PlaceWithIntent<I extends PersistenceIntent> { persistenceIntent: I; place: ProviderPlace }
export type StoragePlace = PlaceWithIntent<'storage'>;
export interface NearbyPlacesInput {
  position: GeoPoint;
  radiusMeters: number;
  locale?: string;
  maxResults?: number;
  persistenceIntent: PersistenceIntent;
}
export interface GetPlaceInput<I extends PersistenceIntent> { placeId: string; locale?: string; persistenceIntent: I }

export interface PlacesProvider {
  searchNearby(input: NearbyPlacesInput): Promise<ProviderResult<ProviderPlace[]>>;
  // Adapters must actually use this intent on GetPlace, not relabel SingleUse data.
  getPlace<I extends PersistenceIntent>(input: GetPlaceInput<I>): Promise<ProviderResult<PlaceWithIntent<I>>>;
}
