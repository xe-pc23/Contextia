import { describe, expect, it } from 'vitest';
import { getScenarioEvidence, weatherAdaptation, weatherAdaptationClear, weatherAdaptationUnavailable } from '@contextia/test-fixtures';
import { RealContextInputSchema, WeatherSnapshotSchema } from '@contextia/contracts';
import type { CalendarEventContext, CandidateEvidence, WeatherSnapshot } from '@contextia/contracts';
import { createDetectorRegistry, normalizeDetectorContext, refineCandidates } from '../src/index.js';
import { normalized, refined, primaryCandidates } from './detectorHarness.js';

function weatherEvidence(patch: Partial<WeatherSnapshot> = {}) {
  const evidence = getScenarioEvidence(weatherAdaptation);
  const snapshot = WeatherSnapshotSchema.parse(evidence.weather[0]?.result.data);
  evidence.weather = [{ need: 'weather-today', result: { status: 'ok', data: { ...snapshot, ...patch } } }];
  return evidence;
}

async function refinedRealWeather(at: string, evidence: CandidateEvidence) {
  const context = normalizeDetectorContext({
    context: RealContextInputSchema.parse({ ...weatherAdaptation.context, mode: 'real', deliveryMode: 'proactive' }),
    preferences: weatherAdaptation.preferences, profileTimezone: weatherAdaptation.preferences.timezone,
    clock: { now: () => new Date(at) }
  });
  const detector = createDetectorRegistry().find(value => value.type === 'WEATHER_ADAPTATION');
  if (!detector) throw new Error('Expected weather detector');
  return refineCandidates({ context, candidates: await detector.detect(context), evidence });
}

const upcomingEvent: CalendarEventContext = {
  id: 'planned-movement', title: 'Meeting', startAt: '2026-10-01T16:00:00+09:00', endAt: '2026-10-01T17:00:00+09:00',
  location: 'Tokyo Station'
};

function worseningForecast(startAt = '2026-10-01T15:00:00+09:00', endAt = '2026-10-01T17:00:00+09:00') {
  return weatherEvidence({
    condition: 'clear', temperatureCelsius: 24, feelsLikeCelsius: null, precipitationProbability: 0, precipitationMillimeters: 0,
    forecast: [{ startAt, endAt, condition: 'rain', temperatureCelsius: 22, precipitationProbability: 90, precipitationMillimeters: 5 }]
  });
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

  it('detects worsening weather before the next event despite a clear current observation', async () => {
    const result = await refined(weatherAdaptation, { calendar: [upcomingEvent] }, worseningForecast());
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.requiredSignals).toContain('calendar');
    expect(result.candidates[0]?.facts).toMatchObject({
      evaluationAt: '2026-10-01T05:30:00.000Z', nextEventId: upcomingEvent.id,
      weatherAssessmentAt: '2026-10-01T06:00:00.000Z', weatherIssues: ['precipitation'],
      weather: {
        source: 'forecast', sourceTimestamp: '2026-10-01T14:30:00+09:00', condition: 'rain',
        startAt: '2026-10-01T15:00:00+09:00', endAt: '2026-10-01T17:00:00+09:00', precipitationMillimeters: 5
      }
    });
  });

  it('checks a rainy interval before movement even if the forecast is clear at event start', async () => {
    const evidence = worseningForecast('2026-10-01T15:00:00+09:00', '2026-10-01T15:30:00+09:00');
    const entry = evidence.weather[0];
    if (entry?.result.status !== 'ok') throw new Error('Expected forecast fixture');
    entry.result.data.forecast.push({
      startAt: '2026-10-01T15:30:00+09:00', endAt: '2026-10-01T17:00:00+09:00',
      condition: 'clear', temperatureCelsius: 24, precipitationProbability: 0, precipitationMillimeters: 0
    });
    expect((await refined(weatherAdaptation, { calendar: [upcomingEvent] }, evidence)).candidates).toHaveLength(1);
  });

  it('uses a forecast for future movement within the current observation freshness interval', async () => {
    const next = { ...upcomingEvent, startAt: '2026-10-01T15:15:00+09:00' };
    const result = await refined(weatherAdaptation, { calendar: [next] }, worseningForecast());
    expect(result.candidates[0]?.facts.weather).toMatchObject({ source: 'forecast', condition: 'rain' });
  });

  it('uses covered upcoming forecast evidence when the current observation has expired', async () => {
    const evidence = worseningForecast();
    const entry = evidence.weather[0];
    if (entry?.result.status !== 'ok') throw new Error('Expected forecast fixture');
    entry.result.data.sourceTimestamp = '2026-10-01T12:00:00+09:00';
    expect((await refined(weatherAdaptation, { calendar: [upcomingEvent] }, evidence)).candidates[0]?.facts.weather).toMatchObject({
      source: 'forecast', sourceTimestamp: '2026-10-01T12:00:00+09:00'
    });
  });

  it.each([
    ['2026-10-01T13:30:00+09:00', '2026-10-01T14:30:00+09:00', 0],
    ['2026-10-01T16:00:00+09:00', '2026-10-01T17:00:00+09:00', 1],
    ['2026-10-01T16:00:00.001+09:00', '2026-10-01T17:00:00+09:00', 0],
    ['2026-10-01T15:00:00+09:00', '2026-10-01T15:00:00+09:00', 0]
  ])('only assesses nonempty forecast coverage relevant to movement [%s, %s)', async (startAt, endAt, count) => {
    const result = await refined(weatherAdaptation, { calendar: [upcomingEvent] }, worseningForecast(startAt, endAt));
    expect(result.candidates).toHaveLength(count);
  });

  it.each([
    { calendar: [] },
    { calendar: [{ ...upcomingEvent, allDay: true }] },
    { calendar: [{ ...upcomingEvent, startAt: '2026-10-01T14:00:00+09:00' }] },
    { calendar: [upcomingEvent, { ...upcomingEvent, startAt: '2026-10-01T15:45:00+09:00' }] }
  ])('does not attach future weather to absent, untimed, started or conflicting plans %#', async ({ calendar }) => {
    expect((await refined(weatherAdaptation, { calendar }, worseningForecast())).candidates).toEqual([]);
  });

  it('does not use older rainy forecast where a newer clear forecast covers the same period', async () => {
    const evidence = worseningForecast();
    const entry = evidence.weather[0];
    if (entry?.result.status !== 'ok') throw new Error('Expected forecast fixture');
    const snapshot = entry.result.data;
    evidence.weather.push({ need: 'weather-today', result: { status: 'ok', data: {
      ...snapshot, sourceTimestamp: '2026-10-01T14:31:00+09:00',
      forecast: snapshot.forecast.map(window => ({ ...window, condition: 'clear', precipitationMillimeters: 0, precipitationProbability: 0 }))
    } } });
    expect((await refined(weatherAdaptation, { calendar: [upcomingEvent] }, evidence)).candidates).toEqual([]);
  });

  it('detects older covered rain after newer clear forecast coverage ends', async () => {
    const evidence = worseningForecast();
    const entry = evidence.weather[0];
    if (entry?.result.status !== 'ok') throw new Error('Expected forecast fixture');
    const snapshot = entry.result.data;
    evidence.weather.push({ need: 'weather-today', result: { status: 'ok', data: {
      ...snapshot, sourceTimestamp: '2026-10-01T14:31:00+09:00',
      forecast: snapshot.forecast.map(window => ({
        ...window, endAt: '2026-10-01T15:30:00+09:00', condition: 'clear', precipitationMillimeters: 0, precipitationProbability: 0
      }))
    } } });
    expect((await refined(weatherAdaptation, { calendar: [upcomingEvent] }, evidence)).candidates[0]?.facts).toMatchObject({
      weatherAssessmentAt: '2026-10-01T06:30:00.000Z', weather: { source: 'forecast', condition: 'rain' }
    });
  });

  it('requires calendar availability for planned movement but keeps current adverse weather independent', async () => {
    const patch = { calendar: [upcomingEvent] };
    const context = normalized(weatherAdaptation, patch);
    const candidates = await primaryCandidates(weatherAdaptation, patch);
    const availableSignals = ['time', 'location', 'weather'] as const;
    expect(refineCandidates({ context, candidates, evidence: worseningForecast(), availableSignals }).candidates).toEqual([]);
    expect(refineCandidates({ context, candidates, evidence: weatherEvidence(), availableSignals }).candidates).toHaveLength(1);
  });

  it('does not substitute current weather for a past/future simulation or trust a forged requested at', async () => {
    const evidence = weatherEvidence({ at: '2000-01-01T14:30:00+09:00', forecast: [] });
    expect((await refined(weatherAdaptation, { scenarioTime: '2000-01-01T14:30:00+09:00' }, evidence)).candidates).toEqual([]);
    expect((await refined(weatherAdaptation, { scenarioTime: '2030-01-01T14:30:00+09:00' }, evidence)).candidates).toEqual([]);
  });

  it.each([
    ['2026-10-01T15:29:59.999+09:00', 1],
    ['2026-10-01T15:30:00+09:00', 0]
  ])('bounds current-observation freshness in real mode at %s', async (at, count) => {
    expect((await refinedRealWeather(at, weatherEvidence({ forecast: [] }))).candidates).toHaveLength(count);
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

  it.each([
    '2026-10-01T15:00:00+09:00',
    '2026-10-01T15:15:00+09:00',
    '2026-10-01T15:29:59.999+09:00',
    '2026-10-01T15:30:00+09:00',
    '2026-10-01T15:59:59.999+09:00'
  ])('uses the covering rainy forecast throughout a future simulation at %s', async scenarioTime => {
    const evidence = worseningForecast('2026-10-01T15:00:00+09:00', '2026-10-01T16:00:00+09:00');
    const result = await refined(weatherAdaptation, { scenarioTime }, evidence);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.facts).toMatchObject({
      nextEventId: null, weatherAssessmentAt: new Date(scenarioTime).toISOString(),
      weather: { source: 'forecast', condition: 'rain', sourceTimestamp: '2026-10-01T14:30:00+09:00' }
    });
    expect(result.candidates[0]?.requiredSignals).not.toContain('calendar');
  });

  it.each([
    '2026-10-01T15:00:00+09:00',
    '2026-10-01T15:15:00+09:00',
    '2026-10-01T15:29:59.999+09:00',
    '2026-10-01T15:30:00+09:00'
  ])('does not project a rainy current observation into a clear future forecast at %s', async scenarioTime => {
    const evidence = weatherEvidence({ forecast: [{
      startAt: '2026-10-01T15:00:00+09:00', endAt: '2026-10-01T16:00:00+09:00',
      condition: 'clear', temperatureCelsius: 24, precipitationProbability: 0, precipitationMillimeters: 0
    }] });
    expect((await refined(weatherAdaptation, { scenarioTime }, evidence)).candidates).toEqual([]);
  });

  it.each(['2026-10-01T14:30:00.001+09:00', '2026-10-01T15:15:00+09:00'])('does not apply a fresh past observation to an uncovered future simulation at %s', async scenarioTime => {
    const result = await refined(weatherAdaptation, { scenarioTime }, weatherEvidence({ forecast: [] }));
    expect(result.candidates).toEqual([]);
    expect(result.exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not fall back to a fresh observation at the forecast end boundary in simulation', async () => {
    const evidence = weatherEvidence({ sourceTimestamp: '2026-10-01T15:30:00+09:00' });
    const result = await refined(weatherAdaptation, { scenarioTime: '2026-10-01T16:00:00+09:00' }, evidence);
    expect(result.candidates).toEqual([]);
    expect(result.exclusions[0]?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('keeps fresh current observations usable at real time instead of treating real time as a future simulation', async () => {
    const evidence = weatherEvidence({ forecast: [{
      startAt: '2026-10-01T15:00:00+09:00', endAt: '2026-10-01T16:00:00+09:00',
      condition: 'clear', temperatureCelsius: 24, precipitationProbability: 0, precipitationMillimeters: 0
    }] });
    const result = await refinedRealWeather('2026-10-01T15:15:00+09:00', evidence);
    expect(result.candidates[0]?.facts.weather).toMatchObject({ source: 'current', condition: 'rain' });
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
