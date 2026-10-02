import { PlaceSchema, RecommendationRouteSchema } from '@contextia/contracts';
import type { Place, ProviderPlace, RecommendationItem, RecommendationRoute, RouteSummary } from '@contextia/contracts';
import type { ProviderEnrichment } from '@contextia/providers';

export function publicPlace(place: ProviderPlace): Place {
  return PlaceSchema.parse({
    provider: place.provider, placeId: place.placeId, name: place.name,
    latitude: place.latitude, longitude: place.longitude,
    ...(place.distanceMeters === undefined ? {} : { distanceMeters: place.distanceMeters })
  });
}

export function publicRoute(route: RouteSummary): RecommendationRoute {
  return RecommendationRouteSchema.parse({
    mode: route.mode, durationMinutes: route.durationMinutes,
    ...(route.departAt === undefined ? {} : { departAt: route.departAt }),
    ...(route.arriveAt === undefined ? {} : { arriveAt: route.arriveAt }),
    ...(route.transfers === undefined ? {} : { transfers: route.transfers })
  });
}

export function suppliedPlaces(enrichment: ProviderEnrichment): Map<string, ProviderPlace> {
  return new Map(enrichment.places.flatMap(entry => entry.result.data ?? []).map(place => [place.placeId, place]));
}

export function suppliedRoutes(enrichment: ProviderEnrichment): RouteSummary[] {
  return enrichment.routes.flatMap(entry => entry.result.data ? [entry.result.data] : []);
}

export function matchingRoute(reference: RecommendationRoute, routes: readonly RecommendationRoute[]): RecommendationRoute | undefined {
  return routes.find(route => route.mode === reference.mode && route.durationMinutes === reference.durationMinutes
    && (reference.departAt === undefined || reference.departAt === route.departAt)
    && (reference.arriveAt === undefined || reference.arriveAt === route.arriveAt)
    && (reference.transfers === undefined || reference.transfers === route.transfers));
}

export function referenceError(
  items: readonly RecommendationItem[], enrichment: ProviderEnrichment,
  routes: readonly RecommendationRoute[] = suppliedRoutes(enrichment)
): string | null {
  const places = suppliedPlaces(enrichment);
  for (const item of items) {
    if (item.place && !places.has(item.place.placeId)) return 'UNKNOWN_PLACE_REFERENCE';
    if (item.route && !matchingRoute(item.route, routes)) return 'UNKNOWN_ROUTE_REFERENCE';
    if (item.action.type === 'WEBSITE' && item.action.url) {
      const place = item.place ? places.get(item.place.placeId) : undefined;
      if (!place?.websiteUrl || place.websiteUrl !== item.action.url) return 'UNKNOWN_ACTION_REFERENCE';
    }
  }
  return null;
}
