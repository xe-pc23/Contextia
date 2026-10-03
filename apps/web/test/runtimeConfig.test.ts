import { describe, expect, it } from 'vitest';
import { loadWebConfig, parseWebConfig } from '../src/runtimeConfig.js';

import { configFixture } from './support/config.js';

describe('Web runtime configuration', () => {
  it('loads deployed runtime config without credentials or stale caching', async () => {
    let request: RequestInit | undefined;
    const config = await loadWebConfig(async (url, options) => {
      expect(url).toBe('/config.json'); request = options;
      return new Response(JSON.stringify(configFixture));
    });
    expect(config.apiBaseUrl).toBe('https://api.example.com');
    expect(request).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
  });
  it.each(['http://api.example.com', 'https://name:password@api.example.com', 'https://api.example.com?token=secret'])('rejects unsafe API origins: %s', apiBaseUrl => {
    expect(() => parseWebConfig({ ...configFixture, apiBaseUrl })).toThrow();
  });
  it('rejects insecure production callback and malformed auth/map config', () => {
    expect(() => parseWebConfig({ ...configFixture, stage: 'prod', auth: { ...configFixture.auth, redirectUri: 'http://localhost:5173/' } })).toThrow();
    expect(() => parseWebConfig({ ...configFixture, map: { ...configFixture.map, apiKey: '' } })).toThrow();
    expect(() => parseWebConfig({ ...configFixture, auth: { ...configFixture.auth, cognitoDomain: 'javascript:alert(1)' } })).toThrow();
  });
  it('fails closed on a missing or non-JSON configuration', async () => {
    await expect(loadWebConfig(async () => new Response('not configured', { status: 404 }))).rejects.toThrow('設定を読み込めません');
    await expect(loadWebConfig(async () => new Response('private malformed response'))).rejects.toThrow('設定を読み込めません');
  });
});
