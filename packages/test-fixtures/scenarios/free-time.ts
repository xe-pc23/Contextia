import type { ScenarioFixture } from '../src/types.js';
import { cafe, context, event, position, preferences, walkingRoute, weather } from './shared.js';

const input = context('2026-10-01T14:10:00+09:00');
export const freeTime: ScenarioFixture = {
  id: 'free-time', label: '予定までの空き時間', primaryTrigger: 'FREE_TIME_NEARBY',
  providerNeeds: ['places-near-current', 'weather-current', 'route-to-place-candidates', 'geocode-event-location'], context: { ...input, calendar: [event] }, preferences,
  providers: {
    geocoding: { status: 'ok', data: [{ ...position, provider: 'amazon-location', placeId: 'synthetic-station-1', name: 'Synthetic station', confidence: 0.98 }] },
    places: { status: 'ok', data: [cafe] }, weather: { status: 'ok', data: weather(input.capturedAt) },
    routes: { status: 'ok', data: [walkingRoute('free-out', position, cafe, 4), walkingRoute('free-return', cafe, position, 4)] }
  }
};

export const freeTimeWithoutRoutes: ScenarioFixture = {
  ...freeTime, label: 'ルート未対応でも空き時間を評価',
  providers: { ...freeTime.providers, routes: { status: 'unavailable', data: null } }
};

export const freeTimeShortGap: ScenarioFixture = {
  ...freeTime, label: '短すぎる空き時間',
  context: { ...freeTime.context, scenarioTime: '2026-10-01T15:45:00+09:00' }
};
