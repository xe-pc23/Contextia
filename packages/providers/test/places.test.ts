import { describe, expect, it, vi } from 'vitest';
import { AmazonLocationPlacesProvider } from '../src/adapters/places.js';
import type { AmazonLocationPlacesClient } from '../src/adapters/places.js';

const locationResponse = (overrides: Record<string, unknown> = {}): unknown => ({
  PlaceId: 'place-1',
  Title: 'Cafe North',
  Position: [139.7671, 35.6812],
  Distance: 120,
  Categories: [{ Name: 'Cafe' }],
  ...overrides
});

function testProvider(overrides: Partial<AmazonLocationPlacesClient> = {}, timeoutMs = 50) {
  const searchNearby = vi.fn<AmazonLocationPlacesClient['searchNearby']>().mockResolvedValue({ ResultItems: [locationResponse()] });
  const getPlace = vi.fn<AmazonLocationPlacesClient['getPlace']>().mockResolvedValue(locationResponse());
  const client: AmazonLocationPlacesClient = { searchNearby, getPlace, ...overrides };
  return { provider: new AmazonLocationPlacesProvider({ client, timeoutMs }), searchNearby, getPlace };
}

describe('AmazonLocationPlacesProvider', () => {
  it('uses Places V2 coordinate order, an explicit intent, and caps results at 30', async () => {
    const { provider, searchNearby } = testProvider();

    const result = await provider.searchNearby({
      position: { latitude: 35.6812, longitude: 139.7671 },
      radiusMeters: 1_000,
      locale: 'ja-JP',
      maxResults: 80,
      persistenceIntent: 'single-use'
    });

    expect(searchNearby).toHaveBeenCalledWith({
      QueryPosition: [139.7671, 35.6812],
      QueryRadius: 1_000,
      Language: 'ja-JP',
      MaxResults: 30,
      IntendedUse: 'SingleUse'
    }, expect.any(AbortSignal));
    expect(result).toMatchObject({
      status: 'ok',
      data: [{
        provider: 'amazon-location', placeId: 'place-1', name: 'Cafe North',
        latitude: 35.6812, longitude: 139.7671, distanceMeters: 120, categoryNames: ['Cafe']
      }]
    });
  });

  it('returns an empty successful list when Places finds no results', async () => {
    const { provider } = testProvider({
      searchNearby: vi.fn().mockResolvedValue({ ResultItems: [] })
    });

    await expect(provider.searchNearby({
      position: { latitude: 35.6, longitude: 139.7 }, radiusMeters: 1_000,
      persistenceIntent: 'single-use'
    })).resolves.toMatchObject({ status: 'ok', data: [] });
  });

  it('drops malformed result rows while retaining valid normalized candidates as degraded data', async () => {
    const { provider } = testProvider({
      searchNearby: vi.fn().mockResolvedValue({ ResultItems: [locationResponse(), { PlaceId: 'broken' }] })
    });

    await expect(provider.searchNearby({
      position: { latitude: 35.6, longitude: 139.7 }, radiusMeters: 500,
      persistenceIntent: 'single-use'
    })).resolves.toMatchObject({ status: 'degraded', data: [{ placeId: 'place-1' }], code: 'INVALID_ITEMS' });
  });

  it('removes duplicate place IDs before returning candidates for Bedrock', async () => {
    const { provider } = testProvider({
      searchNearby: vi.fn().mockResolvedValue({ ResultItems: [locationResponse(), locationResponse({ Title: 'Duplicate name' })] })
    });

    await expect(provider.searchNearby({
      position: { latitude: 35.6, longitude: 139.7 }, radiusMeters: 500,
      persistenceIntent: 'single-use'
    })).resolves.toMatchObject({ status: 'ok', data: [{ placeId: 'place-1', name: 'Cafe North' }] });
  });

  it('uses GetPlace with Storage intent and rejects a mismatched returned ID', async () => {
    const { provider, getPlace } = testProvider();

    const result = await provider.getPlace({ placeId: 'place-1', persistenceIntent: 'storage' });

    expect(getPlace).toHaveBeenCalledWith({ PlaceId: 'place-1', IntendedUse: 'Storage' }, expect.any(AbortSignal));
    expect(result).toMatchObject({ status: 'ok', data: { persistenceIntent: 'storage', place: { placeId: 'place-1' } } });

    const mismatched = testProvider({ getPlace: vi.fn().mockResolvedValue(locationResponse({ PlaceId: 'other-place' })) });
    await expect(mismatched.provider.getPlace({ placeId: 'place-1', persistenceIntent: 'storage' }))
      .resolves.toMatchObject({ status: 'error', data: null, code: 'PLACE_ID_MISMATCH' });
  });

  it('maps timeout and upstream error categories without leaking messages', async () => {
    const timed = testProvider({
      searchNearby: vi.fn((_request, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('private timeout payload')), { once: true });
      }))
    }, 2);
    await expect(timed.provider.searchNearby({
      position: { latitude: 35.6, longitude: 139.7 }, radiusMeters: 500,
      persistenceIntent: 'single-use'
    })).resolves.toMatchObject({ status: 'timeout', data: null, code: 'TIMEOUT' });

    const throttled = testProvider({
      searchNearby: vi.fn().mockRejectedValue(Object.assign(new Error('sensitive upstream response'), { name: 'ThrottlingException' }))
    });
    await expect(throttled.provider.searchNearby({
      position: { latitude: 35.6, longitude: 139.7 }, radiusMeters: 500,
      persistenceIntent: 'single-use'
    })).resolves.toMatchObject({ status: 'error', data: null, code: 'THROTTLED' });
  });
});
