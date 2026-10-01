import type { ScenarioFixture } from '../src/types.js';
import { cafe, context, event, position, preferences, unrequested } from './shared.js';

const input = context('2026-10-01T15:20:00+09:00');
export const earlyArrival: ScenarioFixture = {
  id: 'early-arrival', label: '目的地へ早く到着', primaryTrigger: 'EARLY_ARRIVAL_DETOUR',
  providerNeeds: ['geocode-event-location', 'places-near-destination'], context: { ...input, calendar: [event] }, preferences,
  providers: {
    geocoding: { status: 'ok', data: [{ ...position, provider: 'amazon-location', placeId: 'synthetic-station-1', name: 'Synthetic station', confidence: 0.98 }] },
    places: { status: 'ok', data: [cafe] }, weather: unrequested(), routes: unrequested()
  }
};
