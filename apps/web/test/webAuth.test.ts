import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebAuthSession, pkceChallenge } from '../src/auth/webAuth.js';
import { parseWebConfig } from '../src/runtimeConfig.js';
import { configFixture } from './support/config.js';

function fixture(fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ access_token: 'access-value', refresh_token: 'refresh-value', expires_in: 3600, token_type: 'Bearer' }))) {
  const values = new Map<string, string>();
  let time = 1_000_000; let destination = ''; let cleaned = false; let storageFailure: 'read' | 'remove' | null = null;
  const auth = new WebAuthSession(parseWebConfig(configFixture), {
    storage: { getItem: key => { if (storageFailure === 'read') throw new DOMException('Storage blocked', 'SecurityError'); return values.get(key) ?? null; },
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { if (storageFailure === 'remove') throw new DOMException('Storage blocked', 'SecurityError'); values.delete(key); } },
    crypto: webcrypto as unknown as Crypto, fetch: fetchImpl, now: () => time,
    navigate: value => { destination = value; }, clearCallback: () => { cleaned = true; }, origin: 'https://console.example.com'
  });
  return { auth, values, advance: (ms: number) => { time += ms; }, destination: () => new URL(destination), cleaned: () => cleaned,
    blockStorage: (operation: 'read' | 'remove') => { storageFailure = operation; } };
}

describe('Cognito Web session', () => {
  it('clears the in-memory session and completes logout when PKCE cleanup fails', async () => {
    const f = fixture(); await f.auth.signIn();
    await f.auth.initialize(`https://console.example.com/?code=code&state=${f.destination().searchParams.get('state')}`);
    f.blockStorage('remove');
    expect(() => f.auth.signOut()).not.toThrow();
    expect(f.auth.getSnapshot().status).toBe('signed-out');
    expect(await f.auth.getAccessToken()).toBeNull();
    expect(f.destination().pathname).toBe('/logout');
  });
  it('fails closed and clears the callback when reading PKCE storage fails', async () => {
    let requests = 0; const f = fixture(async () => { requests++; return Response.json({}); });
    await f.auth.signIn(); const callback = `https://console.example.com/?code=code&state=${f.destination().searchParams.get('state')}`;
    f.blockStorage('read'); await f.auth.initialize(callback);
    expect(requests).toBe(0); expect(f.cleaned()).toBe(true);
    expect(f.auth.getSnapshot().status).toBe('signed-out');
  });
  it('uses the RFC7636 SHA256 PKCE challenge', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', webcrypto as unknown as Crypto)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('starts code/PKCE login with an unpredictable state and stores only its short-lived transaction', async () => {
    const f = fixture(); await f.auth.signIn(); const url = f.destination();
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')?.length).toBeGreaterThanOrEqual(32);
    expect(url.searchParams.get('redirect_uri')).toBe('https://console.example.com/');
    expect([...f.values.values()].join('')).not.toContain('access-value');
  });
  it('rejects a mismatched callback state without exchanging or retaining credentials', async () => {
    let requests = 0; const f = fixture(async () => { requests++; return new Response('{}'); });
    await f.auth.signIn(); await f.auth.initialize('https://console.example.com/?code=private-code&state=wrong');
    expect(requests).toBe(0); expect(f.values.size).toBe(0); expect(f.cleaned()).toBe(true);
    expect(f.auth.getSnapshot().status).toBe('signed-out');
    expect(await f.auth.getAccessToken()).toBeNull();
  });
  it('exchanges once, cleans the callback first, and keeps tokens in memory only', async () => {
    let requests = 0; let body = ''; let cleanedAtExchange = false;
    const f = fixture(async (url, init) => {
      requests++; body = String(init?.body); cleanedAtExchange = f.cleaned();
      expect(String(url)).toBe('https://pool.auth.ap-northeast-1.amazoncognito.com/oauth2/token');
      return new Response(JSON.stringify({ access_token: 'access-value', refresh_token: 'refresh-value', expires_in: 3600, token_type: 'Bearer' }));
    });
    await f.auth.signIn(); const state = f.destination().searchParams.get('state');
    const callback = `https://console.example.com/?code=private-code&state=${state}`;
    await Promise.all([f.auth.initialize(callback), f.auth.initialize(callback)]);
    expect(requests).toBe(1); expect(cleanedAtExchange).toBe(true);
    expect(new URLSearchParams(body).get('grant_type')).toBe('authorization_code');
    expect(new URLSearchParams(body).get('code_verifier')?.length).toBeGreaterThanOrEqual(43);
    expect(f.values.size).toBe(0); expect(await f.auth.getAccessToken()).toBe('access-value');
  });
  it('refreshes an expiring session once and signs out when refresh is rejected', async () => {
    let requests = 0;
    const f = fixture(async () => ++requests === 1
      ? new Response(JSON.stringify({ access_token: 'access-value', refresh_token: 'refresh-value', expires_in: 60, token_type: 'Bearer' }))
      : new Response('{}', { status: 400 }));
    await f.auth.signIn(); await f.auth.initialize(`https://console.example.com/?code=code&state=${f.destination().searchParams.get('state')}`);
    f.advance(40_000);
    expect(await Promise.all([f.auth.getAccessToken(), f.auth.getAccessToken()])).toEqual([null, null]);
    expect(requests).toBe(2); expect(f.auth.getSnapshot().status).toBe('signed-out');
  });
  it('rejects an expired login transaction', async () => {
    let requests = 0; const f = fixture(async () => { requests++; return new Response('{}'); });
    await f.auth.signIn(); f.advance(601_000);
    await f.auth.initialize(`https://console.example.com/?code=code&state=${f.destination().searchParams.get('state')}`);
    expect(requests).toBe(0); expect(await f.auth.getAccessToken()).toBeNull();
  });
  it('clears the session and uses the configured Cognito logout callback', async () => {
    const f = fixture(); await f.auth.signIn();
    await f.auth.initialize(`https://console.example.com/?code=code&state=${f.destination().searchParams.get('state')}`);
    f.auth.signOut();
    expect(await f.auth.getAccessToken()).toBeNull();
    expect(f.destination().pathname).toBe('/logout');
    expect(f.destination().searchParams.get('logout_uri')).toBe('https://console.example.com/');
    expect(f.values.size).toBe(0);
  });
  it('refreshes successfully without persisting access or refresh credentials', async () => {
    let requests = 0;
    const f = fixture(async (_url, options) => {
      requests++;
      if (requests === 2) expect(new URLSearchParams(String(options?.body)).get('grant_type')).toBe('refresh_token');
      return Response.json({ access_token: requests === 1 ? 'initial' : 'refreshed', refresh_token: 'refresh', expires_in: 60, token_type: 'Bearer' });
    });
    await f.auth.signIn(); await f.auth.initialize(`https://console.example.com/?code=code&state=${f.destination().searchParams.get('state')}`);
    f.advance(40_000);
    expect(await Promise.all([f.auth.getAccessToken(), f.auth.getAccessToken()])).toEqual(['refreshed', 'refreshed']);
    expect(requests).toBe(2); expect(f.values.size).toBe(0);
  });
});
