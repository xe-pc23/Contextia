import { describe, expect, it } from 'vitest';
import { smokeAuthentication, smokeMode } from './smoke-auth.js';

describe('mandatory dev smoke authentication', () => {
  it('defaults dev to the authenticated gate and labels public diagnostics explicitly', () => {
    expect(smokeMode('dev', {})).toBe('authenticated');
    expect(smokeMode('dev', { SMOKE_MODE: 'public' })).toBe('public');
    expect(() => smokeMode('dev', { SMOKE_MODE: 'skip' })).toThrow();
  });
  it('fails when two credentials or tokens are absent', async () => {
    await expect(smokeAuthentication({}, 'client', async () => 'unused')).rejects.toThrow('Two smoke users');
    await expect(smokeAuthentication({ SMOKE_ACCESS_TOKEN: 'only-one' }, 'client', async () => 'unused')).rejects.toThrow();
  });
  it('mints fresh access tokens for both dedicated dev users', async () => {
    const users: string[] = [];
    const result = await smokeAuthentication({ SMOKE_USER_1_USERNAME: 'one', SMOKE_USER_1_PASSWORD: 'private-one', SMOKE_USER_2_USERNAME: 'two', SMOKE_USER_2_PASSWORD: 'private-two' }, 'dev-web-client', async (client, user, password) => {
      expect(client).toBe('dev-web-client'); expect(password).toBe(`private-${user}`); users.push(user); return `access-${user}`;
    });
    expect(users).toEqual(['one', 'two']);
    expect(result).toEqual({ accessToken: 'access-one', secondUserToken: 'access-two' });
  });
  it('rejects the same identity or token supplied twice', async () => {
    await expect(smokeAuthentication({ SMOKE_ACCESS_TOKEN: 'same', SMOKE_SECOND_USER_ACCESS_TOKEN: 'same' }, 'client', async () => 'unused')).rejects.toThrow();
    await expect(smokeAuthentication({ SMOKE_USER_1_USERNAME: 'one', SMOKE_USER_1_PASSWORD: 'private-one', SMOKE_USER_2_USERNAME: 'one', SMOKE_USER_2_PASSWORD: 'private-two' }, 'client', async () => 'unused')).rejects.toThrow();
  });
});
