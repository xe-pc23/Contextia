import type { GeoPoint, ProviderPlace, ProviderResult, RouteSummary, ScenarioContextInput, UserPreferences, WeatherSnapshot } from '@contextia/contracts';

export const position: GeoPoint = { latitude: 35.681236, longitude: 139.767125 };
export const preferences: UserPreferences = {
  interests: ['cafe', 'park'], stepGoal: 10_000, notificationFrequency: 'normal',
  notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo'
};
export const cafe: ProviderPlace = {
  provider: 'amazon-location', placeId: 'synthetic-cafe-1', name: 'Synthetic test cafe',
  latitude: 35.682, longitude: 139.768, distanceMeters: 150, isOpen: true, categoryNames: ['cafe'], websiteUrl: 'https://example.invalid/cafe'
};
export function context(at: string): ScenarioContextInput {
  return {
    mode: 'simulation', deliveryMode: 'preview', capturedAt: at, scenarioTime: at,
    location: { ...position, accuracyMeters: 10, capturedAt: at, source: 'scenario' },
    activity: { stepsToday: 3000, stepGoal: 10_000, stepGoalReached: false, stepSource: 'scenario', confidence: 'high' },
    calendar: []
  };
}
export function unrequested<T>(): ProviderResult<T> { return { status: 'not_requested', data: null }; }
export function weather(at: string, rainy = false): WeatherSnapshot {
  const facts = { condition: rainy ? 'rain' as const : 'clear' as const, temperatureCelsius: 24, precipitationProbability: rainy ? 90 : 10, precipitationMillimeters: rainy ? 5 : 0 };
  return {
    at, sourceTimestamp: at, timezone: 'Asia/Tokyo', ...facts,
    daily: { date: '2026-10-01', temperatureMinCelsius: 20, temperatureMaxCelsius: 28 },
    forecast: [{ startAt: '2026-10-01T15:00:00+09:00', endAt: '2026-10-01T16:00:00+09:00', ...facts }]
  };
}
export function route(origin: GeoPoint, departAt: string, arriveAt: string, durationMinutes: number): RouteSummary {
  return { routeId: 'synthetic-route-1', origin, destination: position, mode: 'transit', durationMinutes, departAt, arriveAt, transfers: 1, legs: [], warnings: [] };
}
export const event = {
  id: 'synthetic-event-1', title: 'Synthetic meeting', startAt: '2026-10-01T16:00:00+09:00',
  endAt: '2026-10-01T17:00:00+09:00', location: 'Tokyo Station', allDay: false
};
