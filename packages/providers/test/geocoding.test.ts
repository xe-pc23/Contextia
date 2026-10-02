import { describe, expect, it, vi } from 'vitest';
import { AmazonLocationGeocodingProvider, createAmazonLocationGeocodingProvider, defaultGeocodingPolicy, GeocodingInputSchema, normalizeGeocodingResults } from '../src/adapters/geocoding.js';
import type { AmazonLocationGeocodingClient } from '../src/adapters/geocoding.js';
import type { GeocodingInput } from '../src/ports/GeocodingProvider.js';

const input: GeocodingInput = {
  queryText: '東京駅', biasPosition: { latitude: 35.6812, longitude: 139.7671 },
  locale: 'ja-JP', persistenceIntent: 'single-use'
};
const item = (overrides: Record<string, unknown> = {}) => ({
  PlaceId: 'tokyo-station', Title: '東京駅', PlaceType: 'PointOfInterest',
  Position: [139.7671, 35.6812], MatchScores: { Overall: 0.95 }, ...overrides
});

describe('AmazonLocationGeocodingProvider', () => {
  function adapter(response: unknown = { ResultItems: [item()] }) {
    const geocode = vi.fn<AmazonLocationGeocodingClient['geocode']>().mockResolvedValue(response);
    return { geocode, provider: new AmazonLocationGeocodingProvider({ client: { geocode }, timeoutMs: 50 }) };
  }
  it('maps Geocode V2 bias coordinate order, locale, count and transient intent', async () => {
    const { provider, geocode } = adapter();
    expect(await provider.geocode(input)).toMatchObject({ status: 'ok', data: [{ confidence: 0.95 }], latencyMs: expect.any(Number) });
    expect(geocode).toHaveBeenCalledWith({
      QueryText: '東京駅', BiasPosition: [139.7671, 35.6812], Language: 'ja-JP',
      MaxResults: 5, IntendedUse: 'SingleUse'
    }, expect.any(AbortSignal));
  });
  it('maps explicit Storage and omits absent optional fields', async () => {
    const { provider, geocode } = adapter();
    await provider.geocode({ queryText: ' 東京駅 ', persistenceIntent: 'storage' });
    expect(geocode).toHaveBeenCalledWith({ QueryText: '東京駅', MaxResults: 5, IntendedUse: 'Storage' }, expect.any(AbortSignal));
  });
  it('does not call the provider for invalid input', async () => {
    const { provider, geocode } = adapter();
    expect(await provider.geocode({ ...input, queryText: ' ' })).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(geocode).not.toHaveBeenCalled();
  });
  it('keeps ambiguous results unavailable for dependent routes', async () => {
    const { provider } = adapter({ ResultItems: [item(), item({ PlaceId: 'other' })] });
    expect(await provider.geocode(input)).toMatchObject({ status: 'unavailable', data: null, code: 'GEOCODE_AMBIGUOUS' });
  });
  it.each([
    ['AccessDeniedException', 'UPSTREAM_AUTH'], ['ThrottlingException', 'THROTTLED'],
    ['ValidationException', 'UPSTREAM_VALIDATION'], ['InternalServerException', 'UPSTREAM_ERROR']
  ])('sanitizes upstream %s errors', async (name, code) => {
    const { provider, geocode } = adapter();
    geocode.mockRejectedValue(Object.assign(new Error('private upstream body'), { name }));
    const result = await provider.geocode(input);
    expect(result).toMatchObject({ status: 'error', data: null, code });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('bounds latency and aborts a hanging request without returning invented data', async () => {
    let aborted = false;
    const provider = new AmazonLocationGeocodingProvider({ timeoutMs: 5, client: {
      geocode: (_request, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); })
    } });
    expect(await provider.geocode(input)).toMatchObject({ status: 'timeout', data: null, code: 'TIMEOUT' });
    expect(aborted).toBe(true);
  });
  it('lets the composition root provide configuration and a test client without AWS access', async () => {
    const { geocode } = adapter();
    const provider = createAmazonLocationGeocodingProvider({ region: 'ap-northeast-1', timeoutMs: 50 }, { geocode });
    expect(await provider.geocode(input)).toMatchObject({ status: 'ok' });
  });
});
const normalize = (items: unknown[]) => normalizeGeocodingResults({ ResultItems: items }, input);

describe('Geocoding destination guards', () => {
  it('accepts a unique confident destination and strips upstream fields', () => {
    expect(normalize([item({ secret: 'upstream', Address: { Label: 'private' } })])).toEqual({
      status: 'ok', data: [{ provider: 'amazon-location', placeId: 'tokyo-station', name: '東京駅',
        latitude: 35.6812, longitude: 139.7671, confidence: 0.95 }]
    });
  });
  it('never chooses between equally plausible matches or depends on input order', () => {
    const alternatives = [item(), item({ PlaceId: 'other', Title: 'another station', MatchScores: { Overall: 0.9 } })];
    for (const values of [alternatives, [...alternatives].reverse()]) {
      expect(normalize(values)).toEqual({ status: 'unavailable', data: null, code: 'GEOCODE_AMBIGUOUS' });
    }
  });
  it('enforces confidence and score-gap boundaries without inventing confidence', () => {
    expect(normalize([item({ MatchScores: { Overall: 0.799 } })])).toMatchObject({ code: 'GEOCODE_LOW_CONFIDENCE', data: null });
    expect(normalize([item({ MatchScores: { Overall: 0.8 } })])).toMatchObject({ status: 'ok' });
    expect(normalize([item({ MatchScores: undefined })])).toMatchObject({ code: 'GEOCODE_LOW_CONFIDENCE', data: null });
    expect(normalize([item({ MatchScores: { Overall: 0.9 } }), item({ PlaceId: 'less', MatchScores: { Overall: 0.8 } })])).toMatchObject({ status: 'ok' });
  });
  it('rejects empty results, broad regions, and confident but distant matches', () => {
    expect(normalize([])).toMatchObject({ status: 'unavailable', code: 'GEOCODE_NOT_FOUND' });
    expect(normalize([item({ PlaceType: 'Locality' })])).toMatchObject({ code: 'GEOCODE_AMBIGUOUS' });
    expect(normalize([item({ Position: [135.5, 34.7] })])).toMatchObject({ code: 'GEOCODE_OUT_OF_AREA', data: null });
  });
  it('deduplicates matching IDs and fails closed for conflicting or malformed competitors', () => {
    expect(normalize([item(), item()])).toMatchObject({ status: 'ok', data: [expect.any(Object)] });
    expect(normalize([item(), item({ Position: [139.8, 35.7] })])).toMatchObject({ status: 'error', code: 'INVALID_RESPONSE' });
    expect(normalize([item(), { PlaceId: 'malformed' }])).toMatchObject({ status: 'error', data: null });
    expect(normalize([item({ Position: [200, 35] })])).toMatchObject({ status: 'error', data: null });
  });
  it('keeps the distance policy configurable and rejects invalid policy', () => {
    const response = { ResultItems: [item({ Position: [135.5, 34.7] })] };
    expect(normalizeGeocodingResults(response, input, { ...defaultGeocodingPolicy, maxBiasDistanceMeters: 1_000_000 })).toMatchObject({ status: 'ok' });
    expect(normalizeGeocodingResults(response, input, { ...defaultGeocodingPolicy, minConfidence: NaN })).toMatchObject({ status: 'error', code: 'INVALID_POLICY' });
  });
  it.each([
    { ...input, queryText: ' ' }, { ...input, queryText: 'x'.repeat(201) },
    { ...input, biasPosition: { latitude: 91, longitude: 139 } },
    { ...input, persistenceIntent: undefined }, { ...input, ignored: true }
  ])('rejects malformed input before any external call', value => {
    expect(GeocodingInputSchema.safeParse(value).success).toBe(false);
  });
});
