import type { GeoPoint, ProviderResult, RouteMode, RouteSummary } from '@contextia/contracts';

export type RouteInput = { origin: GeoPoint; destination: GeoPoint; mode: RouteMode } & (
  | { departAt: string; arriveBy?: never }
  | { arriveBy: string; departAt?: never }
  | { departAt?: never; arriveBy?: never }
);
export interface RouteProvider {
  // Unsupported transit/intermodal coverage returns unavailable; no invented times.
  getRoute(input: RouteInput): Promise<ProviderResult<RouteSummary>>;
}
