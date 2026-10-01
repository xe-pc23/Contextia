import { describe, expect, it } from 'vitest';
import { PlaceSchema, ProviderPlaceSchema, WeatherSnapshotSchema, providerResultSchema } from '../src/index.js';

const schema = providerResultSchema(PlaceSchema.array());
const place = { provider: 'amazon-location', placeId: 'synthetic-place', name: 'Synthetic cafe', latitude: 35, longitude: 139 };

describe('normalized provider results', () => {
  it.each(['ok', 'degraded'])('allows usable %s data', status => {
    expect(schema.safeParse({ status, data: [place], latencyMs: 10 }).success).toBe(true);
  });
  it.each(['unavailable', 'timeout', 'error', 'not_requested'])('requires null data for %s', status => {
    expect(schema.safeParse({ status, data: null }).success).toBe(true);
    expect(schema.safeParse({ status, data: [place] }).success).toBe(false);
  });
  it('rejects raw upstream objects and incomplete successful data', () => {
    expect(schema.safeParse({ status: 'ok', data: null }).success).toBe(false);
    expect(schema.safeParse({ status: 'ok', data: [{ PlaceId: 'sdk-id', Position: [139, 35] }] }).success).toBe(false);
    expect(schema.safeParse({ status: 'error', data: null, exception: { requestBody: 'private' } }).success).toBe(false);
  });
});

describe('provider facts required by SPEC', () => {
  const weather = {
    at: '2026-10-01T14:10:00+09:00', sourceTimestamp: '2026-10-01T14:00:00+09:00', timezone: 'Asia/Tokyo',
    condition: 'rain', temperatureCelsius: 24, feelsLikeCelsius: 26,
    precipitationProbability: 90, precipitationMillimeters: 5, forecast: [],
    daily: { date: '2026-10-01', temperatureMinCelsius: 20, temperatureMaxCelsius: 28, sunriseAt: '2026-10-01T05:30:00+09:00' }
  };
  it('preserves current, daily and source weather facts without Open-Meteo keys', () => {
    expect(WeatherSnapshotSchema.safeParse(weather).success).toBe(true);
    expect(WeatherSnapshotSchema.safeParse({ ...weather, daily: { ...weather.daily, temperatureMinCelsius: null, temperatureMaxCelsius: null } }).success).toBe(true);
  });
  it('rejects impossible daily temperature ranges and missing source time', () => {
    expect(WeatherSnapshotSchema.safeParse({ ...weather, daily: { ...weather.daily, temperatureMinCelsius: 29 } }).success).toBe(false);
    const { sourceTimestamp: omitted, ...withoutSource } = weather;
    expect(omitted).toBeDefined();
    expect(WeatherSnapshotSchema.safeParse(withoutSource).success).toBe(false);
  });
  it('can retain supplied opening status and website without changing the public place shape', () => {
    const enriched = { ...place, isOpen: true, categoryNames: ['cafe'], websiteUrl: 'https://example.invalid/cafe' };
    expect(ProviderPlaceSchema.safeParse(enriched).success).toBe(true);
    expect(PlaceSchema.safeParse(enriched).success).toBe(false);
  });
});
