import { describe, expect, it } from 'vitest';
import { ensureWebProfile } from '../src/auth/profile.js';

describe('Web profile bootstrap', () => {
  it('preserves a configured API base path', async () => {
    let requested = '';
    await expect(ensureWebProfile('https://api.example.com/dev', 'token', async url => { requested = String(url); return Response.json({}, { status: 401 }); })).rejects.toThrow();
    expect(requested).toBe('https://api.example.com/dev/v1/me');
  });
  it('preserves an existing account preference profile', async () => {
    let calls = 0;
    await ensureWebProfile('https://api.example.com', 'token', async () => {
      calls++; return Response.json({ requestId: 'request', data: { userId: 'user', preferences: { interests: ['museum'], stepGoal: 8000, notificationFrequency: 'low', notificationsEnabled: false, locale: 'ja-JP', timezone: 'Asia/Tokyo' } } });
    });
    expect(calls).toBe(1);
  });
  it('creates defaults only after a schema-valid PROFILE_NOT_FOUND response', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    await ensureWebProfile('https://api.example.com', 'token', async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length === 1
        ? Response.json({ requestId: 'request', error: { code: 'PROFILE_NOT_FOUND', message: 'Missing' } }, { status: 404 })
        : Response.json({ requestId: 'request', data: { updated: true } });
    });
    expect(calls.map(call => call.url)).toEqual(['https://api.example.com/v1/me', 'https://api.example.com/v1/me/preferences']);
    expect(calls[1]?.init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ interests: ['cafe', 'park'], stepGoal: 10000, timezone: 'Asia/Tokyo' });
  });
  it.each([401, 403, 404, 500])('does not overwrite preferences after status %s with another error', async status => {
    let calls = 0;
    await expect(ensureWebProfile('https://api.example.com', 'token', async () => { calls++; return Response.json({ requestId: 'request', error: { code: 'OTHER', message: 'Failure' } }, { status }); })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('rejects a malformed successful response', async () => {
    await expect(ensureWebProfile('https://api.example.com', 'token', async () => Response.json({ private: 'not a profile' }))).rejects.toThrow();
  });
});
