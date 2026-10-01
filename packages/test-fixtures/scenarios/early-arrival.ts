import type { ScenarioFixture } from '../src/types.js';
import { cafe, context, event, position, preferences, unrequested, walkingRoute } from './shared.js';

const input = context('2026-10-01T15:20:00+09:00');
export const earlyArrival: ScenarioFixture = {
  id: 'early-arrival', label: '目的地へ早く到着', primaryTrigger: 'EARLY_ARRIVAL_DETOUR',
  providerNeeds: ['geocode-event-location', 'places-near-destination', 'route-to-place-candidates'], context: { ...input, calendar: [event] }, preferences,
  providers: {
    geocoding: { status: 'ok', data: [{ ...position, provider: 'amazon-location', placeId: 'synthetic-station-1', name: 'Synthetic station', confidence: 0.98 }] },
    places: { status: 'ok', data: [cafe] }, weather: unrequested(), routes: { status: 'ok', data: [walkingRoute('early-out', position, cafe, 4), walkingRoute('early-return', cafe, position, 4)] }
  }
};

export const earlyArrivalFarAway: ScenarioFixture = {
  ...earlyArrival, label: '目的地から遠い位置',
  context: { ...earlyArrival.context, location: { ...earlyArrival.context.location, latitude: 35.658581, longitude: 139.745433 } }
};
