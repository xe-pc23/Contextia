import { describe, expect, it } from 'vitest';
import { mapStyleUrl, parseMapPoint } from '../src/map/mapConfig.js';
import { configFixture } from './support/config.js';
import { parseWebConfig } from '../src/runtimeConfig.js';

describe('Map location selection', () => {
  it('uses the region and restricted public key for Maps V2', () => {
    const url = new URL(mapStyleUrl(parseWebConfig(configFixture).map));
    expect(url.origin).toBe('https://maps.geo.ap-northeast-1.amazonaws.com');
    expect(url.pathname).toBe('/v2/styles/Standard/descriptor');
    expect(url.searchParams.get('key')).toBe('public-restricted-test-key');
  });
  it('keeps latitude/longitude order explicit and normalizes wrapped map longitude', () => {
    expect(parseMapPoint(35, 181)).toEqual({ latitude: 35, longitude: -179 });
    expect(parseMapPoint('35.681236', '139.767125')).toEqual({ latitude: 35.681236, longitude: 139.767125 });
  });
  it.each([[91, 0], [0, Number.NaN], ['', '0'], ['wrong', '0']])('rejects invalid coordinates %s,%s', (latitude, longitude) => {
    expect(parseMapPoint(latitude, longitude)).toBeNull();
  });
});
