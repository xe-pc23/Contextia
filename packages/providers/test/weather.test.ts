import { describe, expect, it, vi } from 'vitest';
import { OpenMeteoWeatherProvider } from '../src/adapters/weather.js';
import type { WeatherHttpClient, WeatherHttpResponse } from '../src/adapters/weather.js';

const weatherResponse = (overrides: Record<string, unknown> = {}): unknown => ({
  latitude: 35.68,
  longitude: 139.76,
  timezone: 'Asia/Tokyo',
  utc_offset_seconds: 32_400,
  current: {
    time: '2026-10-01T14:00',
    temperature_2m: 22,
    apparent_temperature: 23,
    precipitation: 0,
    weather_code: 0
  },
  hourly: {
    time: ['2026-10-01T14:00', '2026-10-01T15:00', '2026-10-01T16:00'],
    temperature_2m: [22, 24, 25],
    apparent_temperature: [23, 26, 26],
    precipitation_probability: [0, 10, 20],
    precipitation: [0, 0, 1],
    weather_code: [0, 3, 61]
  },
  daily: {
    time: ['2026-10-01'],
    temperature_2m_max: [25],
    temperature_2m_min: [18],
    sunrise: ['2026-10-01T05:30'],
    sunset: ['2026-10-01T17:30']
  },
  ...overrides
});

function testProvider(options: {
  payload?: unknown;
  clock?: () => Date;
  timeoutMs?: number;
  fetch?: WeatherHttpClient['fetch'];
} = {}) {
  const fetch = vi.fn<WeatherHttpClient['fetch']>().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => options.payload ?? weatherResponse()
  });
  const client: WeatherHttpClient = { fetch: options.fetch ?? fetch };
  return {
    provider: new OpenMeteoWeatherProvider({
      client,
      endpoint: 'https://weather.example.test/v1/forecast',
      timeoutMs: options.timeoutMs ?? 50,
      clock: { now: options.clock ?? (() => new Date('2026-10-01T05:45:00.000Z')) }
    }),
    fetch
  };
}

const input = {
  position: { latitude: 35.6812, longitude: 139.7671 },
  at: '2026-10-01T06:15:00.000Z',
  timezone: 'Asia/Tokyo'
};

describe('OpenMeteoWeatherProvider', () => {
  it('requests current, hourly, and daily fields and normalizes the requested forecast hour', async () => {
    const { provider, fetch } = testProvider();

    const result = await provider.getWeather(input);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toContain('latitude=35.6812');
    expect(String(url)).toContain('longitude=139.7671');
    expect(String(url)).toContain('current=temperature_2m%2Capparent_temperature%2Cprecipitation%2Cweather_code');
    expect(String(url)).toContain('daily=temperature_2m_max%2Ctemperature_2m_min%2Csunrise%2Csunset');
    expect(String(url)).toContain('hourly=temperature_2m%2Capparent_temperature%2Cprecipitation_probability%2Cprecipitation%2Cweather_code');
    expect(String(url)).toContain('timezone=Asia%2FTokyo');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({
      status: 'ok',
      data: {
        at: input.at,
        sourceTimestamp: '2026-10-01T06:00:00.000Z',
        timezone: 'Asia/Tokyo',
        condition: 'cloudy',
        temperatureCelsius: 24,
        feelsLikeCelsius: 26,
        precipitationProbability: 10,
        precipitationMillimeters: 0,
        daily: {
          date: '2026-10-01', temperatureMinCelsius: 18, temperatureMaxCelsius: 25,
          sunriseAt: '2026-09-30T20:30:00.000Z', sunsetAt: '2026-10-01T08:30:00.000Z'
        },
        forecast: [
          { startAt: '2026-10-01T06:00:00.000Z', endAt: '2026-10-01T07:00:00.000Z' },
          { startAt: '2026-10-01T07:00:00.000Z', endAt: '2026-10-01T08:00:00.000Z' }
        ]
      }
    });
  });

  it('returns unavailable for a time outside the provider day and does not make a request', async () => {
    const { provider, fetch } = testProvider();

    await expect(provider.getWeather({ ...input, at: '2026-10-02T06:15:00.000Z' }))
      .resolves.toMatchObject({ status: 'unavailable', data: null, code: 'FORECAST_OUT_OF_RANGE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns degraded data for missing optional measurements without inventing values', async () => {
    const partial = weatherResponse({
      hourly: {
        time: ['2026-10-01T15:00'], temperature_2m: [null], apparent_temperature: [null],
        precipitation_probability: [null], precipitation: [null], weather_code: [999]
      },
      daily: { time: ['2026-10-01'], temperature_2m_max: [null], temperature_2m_min: [null] }
    });
    const { provider } = testProvider({ payload: partial });

    await expect(provider.getWeather(input)).resolves.toMatchObject({
      status: 'degraded', code: 'PARTIAL_DATA', data: {
        condition: 'unknown', temperatureCelsius: null, feelsLikeCelsius: null,
        precipitationProbability: null, precipitationMillimeters: null,
        daily: { temperatureMinCelsius: null, temperatureMaxCelsius: null }
      }
    });
  });

  it('maps timeout, throttling, and malformed responses to sanitized results', async () => {
    const timed = testProvider({
      timeoutMs: 2,
      fetch: vi.fn<WeatherHttpClient['fetch']>((_url, init) => new Promise<WeatherHttpResponse>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('sensitive response body')), { once: true });
      }))
    });
    await expect(timed.provider.getWeather(input)).resolves.toMatchObject({ status: 'timeout', data: null, code: 'TIMEOUT' });

    const throttled = testProvider({ fetch: vi.fn<WeatherHttpClient['fetch']>().mockResolvedValue({ ok: false, status: 429, json: async () => ({ secret: 'hidden' }) }) });
    await expect(throttled.provider.getWeather(input)).resolves.toMatchObject({ status: 'error', data: null, code: 'THROTTLED' });

    const malformed = testProvider({ payload: { timezone: 'Asia/Tokyo', hourly: { time: ['not-a-time'] } } });
    await expect(malformed.provider.getWeather(input)).resolves.toMatchObject({ status: 'error', data: null, code: 'INVALID_RESPONSE' });
  });

  it('applies the finite timeout while reading the HTTP response body', async () => {
    const bodyRead = testProvider({
      timeoutMs: 2,
      fetch: vi.fn<WeatherHttpClient['fetch']>().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => new Promise<unknown>(() => undefined)
      })
    });
    const timedOut = Symbol('test-timeout');
    const result = await Promise.race([
      bodyRead.provider.getWeather(input),
      new Promise<typeof timedOut>(resolve => setTimeout(() => resolve(timedOut), 30))
    ]);

    expect(result).not.toBe(timedOut);
    expect(result).toMatchObject({ status: 'timeout', data: null, code: 'TIMEOUT' });
  });
});
