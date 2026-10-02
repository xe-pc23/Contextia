import { GeoPointSchema, TimezoneSchema, WeatherSnapshotSchema } from '@contextia/contracts';
import type { ProviderResult, WeatherSnapshot } from '@contextia/contracts';
import { z } from 'zod';
import type { WeatherInput, WeatherProvider } from '../ports/WeatherProvider.js';
import { AdapterTimeoutError, available, elapsedSince, mapAwsError, unavailable, withTimeout } from './shared.js';

const WeatherInputSchema = z.strictObject({
  position: GeoPointSchema,
  at: z.iso.datetime({ offset: true }),
  timezone: TimezoneSchema.optional()
});
const NullableNumber = z.number().finite().nullable();
const NullableInteger = z.number().int().nullable();
const NumericSeries = z.array(NullableNumber).optional();
const IntegerSeries = z.array(NullableInteger).optional();
const StringSeries = z.array(z.string().nullable()).optional();
const OpenMeteoResponseSchema = z.object({
  timezone: z.string().min(1),
  utc_offset_seconds: z.number().int(),
  current: z.object({
    time: z.string(), temperature_2m: NullableNumber.optional(), apparent_temperature: NullableNumber.optional(),
    precipitation: NullableNumber.optional(), weather_code: NullableInteger.optional()
  }).passthrough().optional(),
  hourly: z.object({
    time: z.array(z.string()), temperature_2m: NumericSeries, apparent_temperature: NumericSeries,
    precipitation_probability: NumericSeries, precipitation: NumericSeries, weather_code: IntegerSeries
  }).passthrough().optional(),
  daily: z.object({
    time: z.array(z.string()), temperature_2m_max: NumericSeries, temperature_2m_min: NumericSeries,
    sunrise: StringSeries, sunset: StringSeries
  }).passthrough().optional()
}).passthrough();

const CURRENT_FIELDS = 'temperature_2m,apparent_temperature,precipitation,weather_code';
const HOURLY_FIELDS = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code';
const DAILY_FIELDS = 'temperature_2m_max,temperature_2m_min,sunrise,sunset';

export interface WeatherHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface WeatherHttpClient {
  fetch(url: string, init: { signal: AbortSignal }): Promise<WeatherHttpResponse>;
}

export interface ProviderClock { now(): Date }

export interface OpenMeteoWeatherAdapterOptions {
  client: WeatherHttpClient;
  endpoint: string;
  timeoutMs: number;
  clock: ProviderClock;
}

export interface OpenMeteoWeatherConfig {
  endpoint: string;
  timeoutMs: number;
}

function localDateTime(date: Date, timezone: string): { date: string; hour: string; minute: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const fields = new Map(parts.map(part => [part.type, part.value]));
    const year = fields.get('year');
    const month = fields.get('month');
    const day = fields.get('day');
    const hour = fields.get('hour');
    const minute = fields.get('minute');
    if (!year || !month || !day || !hour || !minute) return null;
    return { date: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return null;
  }
}

function toSourceTimestamp(localTimestamp: string, utcOffsetSeconds: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTimestamp)) return null;
  const localAsUtc = Date.parse(`${localTimestamp}:00Z`);
  if (!Number.isFinite(localAsUtc)) return null;
  return new Date(localAsUtc - utcOffsetSeconds * 1_000).toISOString();
}

function weatherCondition(code: number | null | undefined): WeatherSnapshot['condition'] {
  if (code === 0) return 'clear';
  if (code !== null && code !== undefined && [1, 2, 3, 45, 48].includes(code)) return 'cloudy';
  if (code !== null && code !== undefined && [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if (code !== null && code !== undefined && [71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (code !== null && code !== undefined && [95, 96, 99].includes(code)) return 'storm';
  return 'unknown';
}

function numberAt(values: readonly (number | null)[] | undefined, index: number): number | null {
  const value = values?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateStringAt(values: readonly (string | null)[] | undefined, index: number, offset: number): string | undefined {
  const value = values?.[index];
  if (value === null || value === undefined) return undefined;
  return toSourceTimestamp(value, offset) ?? undefined;
}

function failure<T>(code: string, latencyMs: number, status: 'error' | 'unavailable' = 'error'): ProviderResult<T> {
  return { status, data: null, latencyMs, code };
}

function normalizeWeather(raw: unknown, input: WeatherInput, now: Date): ProviderResult<WeatherSnapshot> {
  const parsed = OpenMeteoResponseSchema.safeParse(raw);
  if (!parsed.success) return { status: 'error', data: null, code: 'INVALID_RESPONSE' };
  const response = parsed.data;
  const localRequested = localDateTime(new Date(input.at), response.timezone);
  const localNow = localDateTime(now, response.timezone);
  if (localRequested === null || localNow === null) return { status: 'error', data: null, code: 'INVALID_RESPONSE' };
  if (localRequested.date !== localNow.date) return { status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' };

  const hourly = response.hourly;
  const targetTime = `${localRequested.date}T${localRequested.hour}:00`;
  const targetIndex = hourly?.time.findIndex(time => time === targetTime) ?? -1;
  const currentTime = response.current?.time;
  const targetMs = Date.parse(input.at);
  const nowMs = now.getTime();
  const canUseCurrent = targetMs <= nowMs && currentTime === targetTime;
  if ((!hourly || targetIndex < 0) && !canUseCurrent) {
    return { status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' };
  }
  if (targetMs < nowMs && !canUseCurrent) {
    return { status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' };
  }

  const daily = response.daily;
  const dailyIndex = daily?.time.findIndex(time => time === localRequested.date) ?? -1;
  if (!daily || dailyIndex < 0) return { status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' };

  const offset = response.utc_offset_seconds;
  const sourceLocalTime = canUseCurrent ? currentTime : hourly?.time[targetIndex];
  if (sourceLocalTime === undefined) return { status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' };
  const sourceTimestamp = toSourceTimestamp(sourceLocalTime, offset);
  const dailyDate = daily.time[dailyIndex];
  if (sourceTimestamp === null || dailyDate === undefined) return { status: 'error', data: null, code: 'INVALID_RESPONSE' };

  const current = response.current;
  const selectedIndex = targetIndex;
  const temperature = canUseCurrent ? current?.temperature_2m ?? null : numberAt(hourly?.temperature_2m, selectedIndex);
  const feelsLike = canUseCurrent ? current?.apparent_temperature ?? null : numberAt(hourly?.apparent_temperature, selectedIndex);
  const precipitation = canUseCurrent ? current?.precipitation ?? null : numberAt(hourly?.precipitation, selectedIndex);
  const precipitationProbability = numberAt(hourly?.precipitation_probability, selectedIndex);
  const conditionCode = canUseCurrent ? current?.weather_code : hourly?.weather_code?.[selectedIndex];
  const condition = weatherCondition(conditionCode);

  const forecast: WeatherSnapshot['forecast'] = [];
  if (hourly) {
    for (let index = Math.max(targetIndex, 0); index < hourly.time.length; index += 1) {
      const time = hourly.time[index];
      if (time === undefined) continue;
      const startAt = toSourceTimestamp(time, offset);
      if (startAt === null) continue;
      const endAt = new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString();
      forecast.push({
        startAt,
        endAt,
        condition: weatherCondition(hourly.weather_code?.[index]),
        temperatureCelsius: numberAt(hourly.temperature_2m, index),
        feelsLikeCelsius: numberAt(hourly.apparent_temperature, index),
        precipitationProbability: numberAt(hourly.precipitation_probability, index),
        precipitationMillimeters: numberAt(hourly.precipitation, index)
      });
    }
  }

  const snapshotCandidate: unknown = {
    at: input.at,
    sourceTimestamp,
    timezone: response.timezone,
    condition,
    temperatureCelsius: temperature,
    feelsLikeCelsius: feelsLike,
    precipitationProbability,
    precipitationMillimeters: precipitation,
    daily: {
      date: dailyDate,
      temperatureMinCelsius: numberAt(daily.temperature_2m_min, dailyIndex),
      temperatureMaxCelsius: numberAt(daily.temperature_2m_max, dailyIndex),
      ...(dateStringAt(daily.sunrise, dailyIndex, offset) === undefined ? {} : { sunriseAt: dateStringAt(daily.sunrise, dailyIndex, offset) }),
      ...(dateStringAt(daily.sunset, dailyIndex, offset) === undefined ? {} : { sunsetAt: dateStringAt(daily.sunset, dailyIndex, offset) })
    },
    forecast
  };
  const snapshot = WeatherSnapshotSchema.safeParse(snapshotCandidate);
  if (!snapshot.success) return { status: 'error', data: null, code: 'INVALID_RESPONSE' };
  const hasPartialData = condition === 'unknown' || temperature === null || feelsLike === null
    || precipitationProbability === null || precipitation === null
    || snapshot.data.daily.temperatureMinCelsius === null || snapshot.data.daily.temperatureMaxCelsius === null;
  return hasPartialData
    ? { status: 'degraded', data: snapshot.data, code: 'PARTIAL_DATA' }
    : { status: 'ok', data: snapshot.data };
}

function defaultHttpClient(): WeatherHttpClient {
  return { fetch: (url, init) => globalThis.fetch(url, init) };
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  private readonly client: WeatherHttpClient;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly clock: ProviderClock;

  constructor(options: OpenMeteoWeatherAdapterOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:') throw new Error('Open-Meteo endpoint must use HTTPS');
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid provider timeout');
    this.client = options.client;
    this.endpoint = endpoint.toString();
    this.timeoutMs = options.timeoutMs;
    this.clock = options.clock;
  }

  async getWeather(input: WeatherInput): Promise<ProviderResult<WeatherSnapshot>> {
    const parsedInput = WeatherInputSchema.safeParse(input);
    if (!parsedInput.success) return { status: 'error', data: null, code: 'INVALID_REQUEST' };
    const value = parsedInput.data;
    const now = this.clock.now();
    const localAt = value.timezone === undefined ? null : localDateTime(new Date(value.at), value.timezone);
    const localNow = value.timezone === undefined ? null : localDateTime(now, value.timezone);
    if (localAt && localNow && localAt.date !== localNow.date) {
      return { status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' };
    }
    if (Date.parse(value.at) < now.getTime() && !(localAt && localNow && localAt.date === localNow.date && localAt.hour === localNow.hour)) {
      return { status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' };
    }

    const url = new URL(this.endpoint);
    url.searchParams.set('latitude', String(value.position.latitude));
    url.searchParams.set('longitude', String(value.position.longitude));
    url.searchParams.set('current', CURRENT_FIELDS);
    url.searchParams.set('hourly', HOURLY_FIELDS);
    url.searchParams.set('daily', DAILY_FIELDS);
    url.searchParams.set('forecast_days', '1');
    url.searchParams.set('timezone', value.timezone ?? 'auto');
    const startedAt = performance.now();
    try {
      const result = await withTimeout(async signal => {
        const response = await this.client.fetch(url.toString(), { signal });
        if (!response.ok) return { response, body: null, invalidJson: false };
        try {
          return { response, body: await response.json(), invalidJson: false };
        } catch {
          return { response, body: null, invalidJson: true };
        }
      }, this.timeoutMs);
      const { response, body } = result;
      if (!response.ok) {
        const status = response.status === 429 ? 'THROTTLED' : `UPSTREAM_HTTP_${response.status}`;
        return failure(status, elapsedSince(startedAt));
      }
      if (result.invalidJson) {
        return failure('INVALID_RESPONSE', elapsedSince(startedAt));
      }
      const normalizedInput: WeatherInput = {
        position: value.position,
        at: value.at,
        ...(value.timezone === undefined ? {} : { timezone: value.timezone })
      };
      const normalized = normalizeWeather(body, normalizedInput, now);
      if (normalized.status === 'ok') return available('ok', normalized.data, elapsedSince(startedAt));
      if (normalized.status === 'degraded') {
        return available('degraded', normalized.data, elapsedSince(startedAt), normalized.code);
      }
      return { ...normalized, latencyMs: elapsedSince(startedAt) };
    } catch (error: unknown) {
      const mapped = error instanceof AdapterTimeoutError ? { status: 'timeout' as const, code: 'TIMEOUT' } : mapAwsError(error);
      return unavailable(mapped.status, elapsedSince(startedAt), mapped.code);
    }
  }
}

export function createOpenMeteoWeatherProvider(
  config: OpenMeteoWeatherConfig,
  client: WeatherHttpClient = defaultHttpClient(),
  clock: ProviderClock = { now: () => new Date() }
): OpenMeteoWeatherProvider {
  return new OpenMeteoWeatherProvider({ client, endpoint: config.endpoint, timeoutMs: config.timeoutMs, clock });
}
