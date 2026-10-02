import type {
  PlacesProvider, GeocodingProvider, WeatherProvider, RouteProvider, RecommendationModel,
  StateRepository, NotificationProvider, StoragePlace, RecommendationWrite, ProactiveDeliveryWrite, ConversationRecord
} from '../src/index.js';
import type { ProviderResult } from '@contextia/contracts';

// Compiled by typecheck, not executed as a production/test adapter.
export async function consumePorts(
  places: PlacesProvider, geocoding: GeocodingProvider, weather: WeatherProvider,
  routes: RouteProvider, model: RecommendationModel, repository: StateRepository, notification: NotificationProvider
) {
  const position = { latitude: 35, longitude: 139 };
  const nearby = await places.searchNearby({ position, radiusMeters: 1000, persistenceIntent: 'single-use' });
  if (nearby.status === 'ok' || nearby.status === 'degraded') {
    const first = nearby.data[0];
    if (first) {
      const selected = await places.getPlace({ placeId: first.placeId, persistenceIntent: 'storage' });
      if (selected.status === 'ok' || selected.status === 'degraded') {
        const storage: StoragePlace = selected.data;
        storage.place.latitude satisfies number;
      }
    }
  }
  await geocoding.geocode({ queryText: 'Tokyo Station', biasPosition: position, persistenceIntent: 'single-use' });
  await weather.getWeather({ position, at: '2026-10-01T05:00:00Z', timezone: 'Asia/Tokyo' });
  await routes.getRoute({ origin: position, destination: position, mode: 'transit', departAt: '2026-10-01T05:00:00Z' });
  await repository.getRecommendation({ userId: 'user-1', recommendationId: 'rec-1', nowEpochSeconds: 1_790_826_000 });
  model.decide satisfies RecommendationModel['decide'];
  notification.send satisfies NotificationProvider['send'];
}

export const transientPlace = { persistenceIntent: 'single-use' as const, place: { provider: 'amazon-location' as const, placeId: 'test', name: 'Test', latitude: 35, longitude: 139 } };
// @ts-expect-error SingleUse data is not proof of a Storage-intent GetPlace.
export const invalidStorage: StoragePlace = transientPlace;
export function prohibitPreviewQuota(write: ProactiveDeliveryWrite) {
  // @ts-expect-error preview cannot consume notification counters through this port.
  write.deliveryMode = 'preview';
}
export function prohibitTransientPersistence(write: RecommendationWrite) {
  // @ts-expect-error persisted selected places require Storage-intent data.
  write.recommendations[0] = { id: 'item', title: 'Test', reason: 'Test', action: { type: 'NONE' }, place: transientPlace };
}
// @ts-expect-error unusable provider results must not contain fabricated data.
export const unavailableWithData: ProviderResult<string[]> = { status: 'unavailable', data: ['fabricated'] };

export function retainedChatFacts(conversation: ConversationRecord) {
  return conversation.messages.flatMap(message => message.role === 'assistant' ? message.recommendations.map(item => item.place?.placeId) : []);
}
