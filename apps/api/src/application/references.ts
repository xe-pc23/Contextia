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
    ...(route.transfers === undefined ? {} : { transfers: route.transfers }),
    ...(route.attributions === undefined ? {} : { attributions: route.attributions })
  });
}

export function suppliedPlaces(enrichment: ProviderEnrichment): Map<string, ProviderPlace> {
  // The model also receives confirmed event destinations from Geocode. Prefer richer Places data on duplicate IDs.
  return new Map<string, ProviderPlace>([
    ...enrichment.geocoding.flatMap(entry => entry.result.data ?? []).map(place => [place.placeId, place] as const),
    ...enrichment.places.flatMap(entry => entry.result.data ?? []).map(place => [place.placeId, place] as const)
  ]);
}

export function suppliedRoutes(enrichment: ProviderEnrichment): RouteSummary[] {
  return enrichment.routes.flatMap(entry => entry.result.data ? [entry.result.data] : []);
}

export function matchingRoute<T extends RecommendationRoute>(reference: RecommendationRoute, routes: readonly T[]): T | undefined {
  return routes.find(route => route.mode === reference.mode && route.durationMinutes === reference.durationMinutes
    && (reference.departAt === undefined || reference.departAt === route.departAt)
    && (reference.arriveAt === undefined || reference.arriveAt === route.arriveAt)
    && (reference.transfers === undefined || reference.transfers === route.transfers)
    && (reference.attributions === undefined || JSON.stringify(reference.attributions) === JSON.stringify(route.attributions)));
}

export function associatedRoutes(item: RecommendationItem, enrichment: ProviderEnrichment): RouteSummary[] {
  return enrichment.routes.flatMap(entry => {
    if (!entry.result.data) return [];
    if (!item.place) return [entry.result.data];
    const associated = entry.need === 'route-to-place-candidates' ? entry.anchorKey === item.place.placeId
      : enrichment.geocoding.some(destination => destination.eventId === entry.anchorKey && destination.result.data?.some(place => place.placeId === item.place?.placeId));
    return associated ? [entry.result.data] : [];
  });
}
export function matchingSavedRoute(item: RecommendationItem, cards: readonly RecommendationItem[]): RecommendationRoute | undefined {
  if (!item.route) return undefined;
  return matchingRoute(item.route, cards.flatMap(card => card.route && (!item.place || card.place?.placeId === item.place.placeId) ? [card.route] : []));
}

export function referenceError(
  items: readonly RecommendationItem[], enrichment: ProviderEnrichment,
  savedCards: readonly RecommendationItem[] = []
): string | null {
  const places = suppliedPlaces(enrichment);
  for (const item of items) {
    if (item.place && !places.has(item.place.placeId)) return 'UNKNOWN_PLACE_REFERENCE';
    if (item.route && !matchingRoute(item.route, associatedRoutes(item, enrichment)) && !matchingSavedRoute(item, savedCards)) return 'UNKNOWN_ROUTE_REFERENCE';
    if (item.action.type === 'WEBSITE' && item.action.url) {
      const place = item.place ? places.get(item.place.placeId) : undefined;
      if (!place?.websiteUrl || place.websiteUrl !== item.action.url) return 'UNKNOWN_ACTION_REFERENCE';
    }
  }
  return null;
}
