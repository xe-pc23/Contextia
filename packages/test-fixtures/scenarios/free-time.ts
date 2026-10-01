import type { ScenarioFixture } from '../src/types.js';
import { cafe, context, event, preferences, unrequested, weather } from './shared.js';

const input = context('2026-10-01T14:10:00+09:00');
export const freeTime: ScenarioFixture = {
  id: 'free-time', label: '予定までの空き時間', primaryTrigger: 'FREE_TIME_NEARBY',
  providerNeeds: ['places-near-current', 'weather-current'], context: { ...input, calendar: [event] }, preferences,
  providers: { geocoding: unrequested(), places: { status: 'ok', data: [cafe] }, weather: { status: 'ok', data: weather(input.capturedAt) }, routes: unrequested() }
};
