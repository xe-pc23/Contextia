import { describe, expect, it } from 'vitest';
import { createAccountServices } from '../src/application/account.js';
import { createRequestHandler } from '../src/handler.js';
import { NOW, ok, preferences, record, repository } from './support/repository.js';

function setup() {
  const state = repository();
  const account = createAccountServices(state, () => NOW);
  const handle = createRequestHandler({ version: 'test', log: () => undefined, clients: { webClientId: 'web', mobileClientId: 'mobile' }, account });
  const request = { requestId: 'req-1', claims: { sub: 'user-1', clientId: 'mobile' } };
  return { state, account, handle, request };
}

describe('profile, preferences, and owned recommendation APIs', () => {
  it('round-trips validated preferences for the authenticated identity', async () => {
    const { handle, request, state } = setup();
    const changed = { ...preferences, interests: ['museum'], timezone: 'America/New_York' };
    const saved = await handle({ ...request, method: 'PUT', path: '/v1/me/preferences', body: JSON.stringify(changed) });
    expect(saved.statusCode).toBe(200);
    expect(JSON.parse(saved.body).data).toEqual({ updated: true });
    const profile = await handle({ ...request, method: 'GET', path: '/v1/me' });
    expect(JSON.parse(profile.body).data).toEqual({ userId: 'user-1', preferences: changed });
    expect(state.putPreferences).toHaveBeenCalledWith({ userId: 'user-1', preferences: changed, at: NOW.toISOString() });
  });

  it.each(['/v1/me', '/v1/recommendations', '/v1/recommendations/rec-owned'])('requires JWT claims for %s', async path => {
    const { handle, state } = setup();
    expect((await handle({ method: 'GET', path, requestId: 'req-unauth' })).statusCode).toBe(401);
    expect(state.getProfile).not.toHaveBeenCalled();
    expect(state.getRecommendation).not.toHaveBeenCalled();
  });

  it('rejects unknown clients and invalid preferences without touching persistence', async () => {
    const { handle, request, state } = setup();
    expect((await handle({ ...request, claims: { sub: 'user-1', clientId: 'other' }, method: 'GET', path: '/v1/me' })).statusCode).toBe(403);
    for (const body of [{ ...preferences, userId: 'victim' }, { ...preferences, timezone: 'invalid' }, { stepGoal: -1 }]) {
      expect((await handle({ ...request, method: 'PUT', path: '/v1/me/preferences', body: JSON.stringify(body) })).statusCode).toBe(400);
    }
    expect(state.putPreferences).not.toHaveBeenCalled();
  });

  it('does not expose expired history or internal persistence attributes', async () => {
    const { handle, request, state } = setup();
    state.listRecommendations.mockResolvedValue(ok({ items: [{ ...record, PK: 'private' }, { ...record, id: 'expired', expiresAt: NOW.getTime() / 1000 }], nextCursor: 'opaque-cursor' }));
    const response = await handle({ ...request, method: 'GET', path: '/v1/recommendations', query: { limit: '50', cursor: 'cursor-before' } });
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body).data;
    expect(data.items).toHaveLength(1);
    expect(data.nextCursor).toBe('opaque-cursor');
    expect(Object.keys(data.items[0]).sort()).toEqual(['createdAt', 'id', 'message', 'recommendations', 'triggerType']);
    expect(state.listRecommendations).toHaveBeenCalledWith({ userId: 'user-1', nowEpochSeconds: NOW.getTime() / 1000, limit: 50, cursor: 'cursor-before' });
  });

  it.each([{ limit: '51' }, { limit: '0' }, { limit: '2.5' }, { userId: 'victim' }, { cursor: '' }])('rejects invalid list query %j', async query => {
    const { handle, request, state } = setup();
    expect((await handle({ ...request, method: 'GET', path: '/v1/recommendations', query })).statusCode).toBe(400);
    expect(state.listRecommendations).not.toHaveBeenCalled();
  });

  it('returns 404 to another user and never retries a global recommendation lookup', async () => {
    const { handle, request, state } = setup();
    const response = await handle({ ...request, claims: { sub: 'other-user', clientId: 'web' }, method: 'GET', path: '/v1/recommendations/rec-owned' });
    expect(response.statusCode).toBe(404);
    expect(state.getRecommendation).toHaveBeenCalledOnce();
    expect(state.getRecommendation).toHaveBeenCalledWith({ userId: 'other-user', recommendationId: 'rec-owned', nowEpochSeconds: NOW.getTime() / 1000 });
  });

  it('handles expired detail and maps safe provider failures', async () => {
    const { handle, request, state } = setup();
    state.getRecommendation.mockResolvedValue(ok({ ...record, expiresAt: NOW.getTime() / 1000 }));
    expect((await handle({ ...request, method: 'GET', path: '/v1/recommendations/rec-owned' })).statusCode).toBe(404);
    state.getProfile.mockResolvedValue({ status: 'error', data: null, code: 'PRIVATE_UPSTREAM' });
    const failed = await handle({ ...request, method: 'GET', path: '/v1/me' });
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('PRIVATE_UPSTREAM');
    state.getProfile.mockResolvedValue(ok(null));
    expect((await handle({ ...request, method: 'GET', path: '/v1/me' })).statusCode).toBe(404);
  });
});
