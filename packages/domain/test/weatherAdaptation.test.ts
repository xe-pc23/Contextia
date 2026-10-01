import { describe, expect, it } from 'vitest';
import { getScenarioEvidence, weatherAdaptation, weatherAdaptationClear, weatherAdaptationUnavailable } from '@contextia/test-fixtures';
import { WeatherSnapshotSchema } from '@contextia/contracts';
import type { WeatherSnapshot } from '@contextia/contracts';
import { refined, primaryCandidates } from './detectorHarness.js';

function weatherEvidence(patch: Partial<WeatherSnapshot> = {}) {
  const evidence = getScenarioEvidence(weatherAdaptation);
  const snapshot = WeatherSnapshotSchema.parse(evidence.weather[0]?.result.data);
  evidence.weather = [{ need: 'weather-today', result: { status: 'ok', data: { ...snapshot, ...patch } } }];
  return evidence;
}

describe('WEATHER_ADAPTATION', () => {
  it('requests weather first and only refines from an actual rainy observation', async () => {
    expect((await primaryCandidates(weatherAdaptation))[0]?.providerNeeds).toEqual(weatherAdaptation.providerNeeds);
    const result = await refined(weatherAdaptation);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.facts).toMatchObject({
      weatherIssues: ['precipitation'], weather: { source: 'current', condition: 'rain', precipitationMillimeters: 5 }
    });
  });

  it('does not make a recommendation candidate for clear or unavailable weather', async () => {
    expect((await refined(weatherAdaptationClear)).candidates).toEqual([]);
    expect((await refined(weatherAdaptationUnavailable)).exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not substitute current weather for a past/future simulation or trust a forged requested at', async () => {
    const evidence = weatherEvidence({ at: '2000-01-01T14:30:00+09:00', forecast: [] });
    expect((await refined(weatherAdaptation, { scenarioTime: '2000-01-01T14:30:00+09:00' }, evidence)).candidates).toEqual([]);
    expect((await refined(weatherAdaptation, { scenarioTime: '2030-01-01T14:30:00+09:00' }, evidence)).candidates).toEqual([]);
  });

  it.each([
    ['2026-10-01T15:29:59.999+09:00', 1],
    ['2026-10-01T15:30:00+09:00', 0]
  ])('bounds the freshness of the source observation at %s', async (scenarioTime, count) => {
    expect((await refined(weatherAdaptation, { scenarioTime }, weatherEvidence({ forecast: [] }))).candidates).toHaveLength(count);
  });

  it.each([
    ['2026-10-01T14:59:59.999+09:00', 0],
    ['2026-10-01T15:00:00+09:00', 1],
    ['2026-10-01T15:59:59.999+09:00', 1],
    ['2026-10-01T16:00:00+09:00', 0]
  ])('uses only the half-open forecast interval at %s', async (scenarioTime, count) => {
    const evidence = weatherEvidence({ sourceTimestamp: '2026-10-01T12:00:00+09:00' });
    const result = await refined(weatherAdaptation, { scenarioTime }, evidence);
    expect(result.candidates).toHaveLength(count);
    if (count) expect(result.candidates[0]?.facts.weather).toMatchObject({ source: 'forecast', condition: 'rain' });
    else expect(result.exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not apply a future current observation or a daily maximum to the scenario moment', async () => {
    const future = weatherEvidence({ sourceTimestamp: '2026-10-01T19:30:00+09:00', forecast: [] });
    expect((await refined(weatherAdaptation, {}, future)).candidates).toEqual([]);
    const onlyDailyHeat = weatherEvidence({
      condition: 'clear', temperatureCelsius: 24, feelsLikeCelsius: null,
      precipitationMillimeters: 0, precipitationProbability: 0, forecast: [],
      daily: { date: '2026-10-01', temperatureMinCelsius: 20, temperatureMaxCelsius: 55 }
    });
    expect((await refined(weatherAdaptation, {}, onlyDailyHeat)).candidates).toEqual([]);
  });

  it.each([[59.999, 0], [60, 1], [60.001, 1]])('keeps precipitation probability factual at %s%%', async (precipitationProbability, count) => {
    const evidence = weatherEvidence({ condition: 'cloudy', precipitationMillimeters: 0, precipitationProbability, forecast: [] });
    const result = await refined(weatherAdaptation, {}, evidence);
    expect(result.candidates).toHaveLength(count);
    if (count) expect(result.candidates[0]?.facts.weather).toMatchObject({ condition: 'cloudy', precipitationProbability });
  });

  it.each([[29.999, 0], [30, 1], [30.001, 1]])('checks the temperature boundary at %s C', async (temperatureCelsius, count) => {
    const evidence = weatherEvidence({
      condition: 'clear', precipitationProbability: null, precipitationMillimeters: null,
      temperatureCelsius, feelsLikeCelsius: null, forecast: []
    });
    expect((await refined(weatherAdaptation, {}, evidence)).candidates).toHaveLength(count);
  });

  it('uses supplied feels-like data but does not infer missing measurements', async () => {
    const warm = weatherEvidence({ condition: 'clear', precipitationProbability: 0, precipitationMillimeters: 0, temperatureCelsius: 26, feelsLikeCelsius: 35 });
    expect((await refined(weatherAdaptation, {}, warm)).candidates[0]?.facts.weatherIssues).toEqual(['heat']);
    const unknown = weatherEvidence({
      condition: 'unknown', precipitationProbability: null, precipitationMillimeters: null,
      temperatureCelsius: null, feelsLikeCelsius: null, forecast: []
    });
    expect((await refined(weatherAdaptation, {}, unknown)).candidates).toEqual([]);
  });

  it('preserves meaningful weather when optional places fail', async () => {
    const evidence = weatherEvidence();
    evidence.places = [{ need: 'places-near-current', anchorKey: 'current', result: { status: 'timeout', data: null } }];
    const result = await refined(weatherAdaptation, {}, evidence);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.facts.eligiblePlaceIds).toEqual([]);
  });

  it('distinguishes an event whose opaque ID is current from an absent event', async () => {
    const absent = await primaryCandidates(weatherAdaptation);
    const scheduled = await primaryCandidates(weatherAdaptation, { calendar: [{
      id: 'current', title: 'Meeting', startAt: '2026-10-01T16:00:00+09:00', endAt: '2026-10-01T17:00:00+09:00'
    }] });
    expect(absent[0]?.anchorKey).not.toBe(scheduled[0]?.anchorKey);
  });

  it('does not require a calendar event or change its anchor on repeat', async () => {
    expect(weatherAdaptation.context.calendar).toEqual([]);
    expect(await primaryCandidates(weatherAdaptation)).toEqual(await primaryCandidates(weatherAdaptation));
  });
});
