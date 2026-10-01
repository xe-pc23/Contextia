import type { ScenarioFixture } from '../src/types.js';
import { context, event, position, preferences, route, unrequested } from './shared.js';

const input = context('2026-10-01T15:10:00+09:00');
const origin = { latitude: 35.658581, longitude: 139.745433 };
export const upcomingTransit: ScenarioFixture = {
  id: 'upcoming-transit', label: '予定前の移動', primaryTrigger: 'UPCOMING_EVENT_TRANSIT',
  providerNeeds: ['geocode-event-location', 'route-to-next-event'],
  context: { ...input, location: { ...input.location, ...origin }, calendar: [event] }, preferences,
  providers: {
    geocoding: { status: 'ok', data: [{ ...position, provider: 'amazon-location', placeId: 'synthetic-station-1', name: 'Synthetic station', confidence: 0.98 }] },
    places: unrequested(), weather: unrequested(),
    routes: { status: 'ok', data: [route(origin, '2026-10-01T15:10:00+09:00', '2026-10-01T15:44:00+09:00', 34)] }
  }
};
