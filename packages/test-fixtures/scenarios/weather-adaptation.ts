import type { ScenarioFixture } from '../src/types.js';
import { cafe, context, preferences, unrequested, weather } from './shared.js';

const input = context('2026-10-01T14:30:00+09:00');
export const weatherAdaptation: ScenarioFixture = {
  id: 'weather-adaptation', label: '天候に合わせた候補（雨はテスト用）', primaryTrigger: 'WEATHER_ADAPTATION',
  providerNeeds: ['weather-today', 'places-near-current'], context: input, preferences,
  providers: { geocoding: unrequested(), places: { status: 'ok', data: [cafe] }, weather: { status: 'ok', data: weather(input.capturedAt, true) }, routes: unrequested() }
};

export const weatherAdaptationClear: ScenarioFixture = {
  ...weatherAdaptation, label: '天気による調整が不要',
  providers: { ...weatherAdaptation.providers, weather: { status: 'ok', data: weather(input.capturedAt) } }
};
export const weatherAdaptationUnavailable: ScenarioFixture = {
  ...weatherAdaptation, label: '天気が取得できない',
  providers: { ...weatherAdaptation.providers, weather: { status: 'unavailable', data: null } }
};
