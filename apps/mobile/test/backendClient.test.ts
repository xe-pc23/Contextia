import { describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, createBackendClient } from '../src/api/backendClient';
import { deferred, historyItem, notify, profile, realInput, silent } from './support/data';

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function setup(response: () => Response | Promise<Response>, token: () => Promise<string | null> = async () => 'test-access-token') {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const createIdempotencyKey = vi.fn<() => string>(() => globalThis.crypto.randomUUID());
  return { fetch, createIdempotencyKey, client: createBackendClient({ baseUrl: 'https://api.example.test/dev', getAccessToken: token, createIdempotencyKey, fetch, timeoutMs: 100 }) };
}

describe('mobile API URL and request boundary', () => {
  it.each(['http://api.example.test', 'http://localhost:3001', 'https://user:password@example.test', 'https://example.test?key=x', 'https://example.test#x', 'https://example.test/v1', 'not a url'])('rejects %s', value => expect(apiBaseUrl(value)).toBeNull());
  it('accepts a HTTPS stage path', () => expect(apiBaseUrl('https://api.example.test/dev')).toBe('https://api.example.test/dev/'));
  it('sends a fresh bearer token and the privacy-minimized real input once', async () => {
    const { client, fetch } = setup(() => json({ requestId: 'req-test', data: notify }));
    expect((await client.evaluate(realInput)).kind).toBe('success');
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.test/dev/v1/context/evaluate');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { authorization: 'Bearer test-access-token' } });
    expect(JSON.parse(String(options?.body))).toEqual(realInput);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('assigns a validated, distinct UUID header to each new evaluation', async () => {
    const { client, fetch } = setup(() => json({ requestId: 'req-test', data: notify }));
    await client.evaluate(realInput); await client.evaluate(realInput);
    const keys = fetch.mock.calls.map(([, options]) => new Headers(options?.headers).get('Idempotency-Key'));
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });
  it.each(['invalid', 'throws'])('does not send an evaluation when UUID generation is %s', async behavior => {
    const { client, fetch, createIdempotencyKey } = setup(() => json(null));
    createIdempotencyKey.mockImplementation(() => {
      if (behavior === 'throws') throw new Error('private random failure');
      return 'invalid';
    });
    expect(await client.evaluate(realInput)).toEqual({ kind: 'invalid-request', fields: ['idempotencyKey'] });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...realInput, mode: 'simulation', deliveryMode: 'preview' },
    { ...realInput, calendar: [{ id: 'evt', title: 'Meeting', startAt: '2026-10-02T02:00:00Z', endAt: '2026-10-02T03:00:00Z', attendees: ['private@example.test'] }] },
    { ...realInput, preferencesOverride: { interests: ['park'] } },
    { ...realInput, scenarioTime: realInput.capturedAt },
    { ...realInput, location: { ...realInput.location, latitude: 91 } }
  ])('does not send invalid or simulated context', async input => {
    const { client, fetch } = setup(() => json(null));
    expect((await client.evaluate(input)).kind).toBe('invalid-request');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not send a request without credentials', async () => {
    const { client, fetch } = setup(() => json(null), async () => null);
    expect(await client.getProfile()).toEqual({ kind: 'unauthenticated' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the profile, preferences, history, and URI-encoded detail routes', async () => {
    const responses = [profile, { updated: true }, { items: [historyItem], nextCursor: 'next+/' }, { ...historyItem, id: 'rec /?' }];
    const { client, fetch } = setup(() => json({ requestId: 'req-test', data: responses.shift() }));
    expect((await client.getProfile()).kind).toBe('success');
    expect((await client.updatePreferences(profile.preferences)).kind).toBe('success');
    expect((await client.listRecommendations({ cursor: 'cursor+/=' })).kind).toBe('success');
    expect((await client.getRecommendation('rec /?')).kind).toBe('success');
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.example.test/dev/v1/me', 'https://api.example.test/dev/v1/me/preferences',
      'https://api.example.test/dev/v1/recommendations?limit=20&cursor=cursor%2B%2F%3D',
      'https://api.example.test/dev/v1/recommendations/rec%20%2F%3F'
    ]);
    expect(fetch.mock.calls.every(([, options]) => !new Headers(options?.headers).has('Idempotency-Key'))).toBe(true);
  });
});

describe('mobile API response boundary', () => {
  it.each([notify, silent])('accepts notify/silent with provider failure', async data => {
    const { client } = setup(() => json({ requestId: 'req-test', data }));
    expect(await client.evaluate(realInput)).toEqual({ kind: 'success', requestId: 'req-test', data });
  });
  it.each([
    { ...notify, delivery: { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: [] } },
    { ...notify, recommendations: [1, 2, 3, 4].map(id => ({ ...historyItem.recommendations[0], id: String(id) })) },
    { ...notify, chainOfThought: 'private' },
    { ...notify, recommendations: [{ ...historyItem.recommendations[0], action: { type: 'WEBSITE', url: 'javascript:alert(1)' } }] },
    { ...notify, providerStatus: { places: { status: 'ok' } } }
  ])('rejects mismatched, unsafe or malformed results', async data => {
    const { client } = setup(() => json({ requestId: 'req-test', data }));
    expect(await client.evaluate(realInput)).toEqual({ kind: 'invalid-response' });
  });
  it('rejects malformed JSON and an unrelated detail ID', async () => {
    const text = setup(() => new Response('<html>private upstream</html>'));
    expect(await text.client.getProfile()).toEqual({ kind: 'invalid-response' });
    const detail = setup(() => json({ requestId: 'req-test', data: historyItem }));
    expect(await detail.client.getRecommendation('another-id')).toEqual({ kind: 'invalid-response' });
  });
  it.each([403, 404, 429, 503])('maps HTTP %i without exposing the upstream message or retrying', async status => {
    const { client, fetch } = setup(() => json({ requestId: 'req-error', error: { code: 'UPSTREAM_ERROR', message: 'private-token-in-body' } }, status));
    const result = await client.evaluate(realInput);
    expect(result).toEqual({ kind: 'http-error', status, code: 'UPSTREAM_ERROR', requestId: 'req-error' });
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['profile', 'preferences', 'evaluation'])('invalidates the current session on a %s 401 without replaying the operation', async operation => {
    const auth = new AbortController();
    const response = json({ error: 'private-token-in-body' }, 401);
    const read = vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => undefined));
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const onUnauthorized = vi.fn(async () => { auth.abort(); });
    const client = createBackendClient({
      baseUrl: 'https://api.example.test', getAccessToken: async () => 'test-access-token',
      createIdempotencyKey: () => globalThis.crypto.randomUUID(), getSessionSignal: () => auth.signal, onUnauthorized, fetch
    });
    const result = operation === 'profile' ? await client.getProfile()
      : operation === 'preferences' ? await client.updatePreferences(profile.preferences) : await client.evaluate(realInput);
    expect(result).toEqual({ kind: 'unauthenticated' });
    expect(onUnauthorized).toHaveBeenCalledWith('test-access-token', auth.signal);
    expect(auth.signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });
  it('maps 401 to unauthenticated without leaking a failed storage cleanup', async () => {
    const client = createBackendClient({
      baseUrl: 'https://api.example.test', getAccessToken: async () => 'test-access-token',
      createIdempotencyKey: () => globalThis.crypto.randomUUID(),
      onUnauthorized: async () => { throw new Error('private storage error'); }, fetch: async () => json(null, 401)
    });
    expect(await client.getProfile()).toEqual({ kind: 'unauthenticated' });
  });
  it('returns a network error', async () => {
    const { client } = setup(() => { throw new Error('private network exception'); });
    expect(await client.getProfile()).toEqual({ kind: 'network-error' });
  });
  it('times out even when fetch ignores its abort signal', async () => {
    const { client } = setup(() => new Promise<Response>(() => undefined));
    expect(await client.getProfile()).toEqual({ kind: 'timeout' });
  });
  it('bounds token acquisition and never sends after timeout', async () => {
    const token = deferred<string | null>();
    const { client, fetch } = setup(() => json(null), () => token.promise);
    expect(await client.getProfile()).toEqual({ kind: 'timeout' });
    token.resolve('late-token');
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels before and during a request', async () => {
    const { client, fetch } = setup(() => new Promise<Response>(() => undefined));
    const before = new AbortController(); before.abort();
    expect(await client.getProfile(before.signal)).toEqual({ kind: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
    const during = new AbortController();
    const pending = client.getProfile(during.signal);
    await Promise.resolve(); during.abort();
    expect(await pending).toEqual({ kind: 'cancelled' });
  });
  it('does not send an already-acquired token when the auth session is cleared before fetch', async () => {
    const auth = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(null));
    const client = createBackendClient({
      baseUrl: 'https://api.example.test', fetch,
      createIdempotencyKey: () => globalThis.crypto.randomUUID(),
      getAccessToken: async () => 'old-access-token', getSessionSignal: () => auth.signal
    });
    const request = client.getProfile();
    auth.abort();
    expect(await request).toEqual({ kind: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
