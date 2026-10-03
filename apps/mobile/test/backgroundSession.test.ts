import { expect, it } from 'vitest';
import { createBackgroundSession } from '../src/background/session';
import type { StoredSession } from '../src/auth/sessionModel';

it('reads a fresh session without refresh or writes, and fences logout/account changes', async () => {
  let session: StoredSession | null = { accessToken: 'current', refreshToken: 'identity', expiresAtEpochSeconds: 200 };
  const enabled = true;
  const background = await createBackgroundSession({ read: async () => session, enabled: async identity => enabled && identity === 'identity', now: () => 100 });
  expect(await background?.getAccessToken()).toBe('current');
  session = { ...session!, accessToken: 'new-current' };
  expect(await background?.getAccessToken()).toBe('new-current');
  session = { ...session, refreshToken: 'different-account' };
  expect(await background?.getAccessToken()).toBeNull();
  session = null;
  expect(await background?.isCurrent()).toBe(false);
});
it('skips expired, locked, malformed and disabled sessions without attempting authentication', async () => {
  const options = { enabled: async () => true, now: () => 100 };
  expect(await createBackgroundSession({ ...options, read: async () => ({ accessToken: 'expired', expiresAtEpochSeconds: 130 }) })).toBeNull();
  expect(await createBackgroundSession({ ...options, read: async () => { throw new Error('locked'); } })).toBeNull();
  expect(await createBackgroundSession({ ...options, read: async () => null })).toBeNull();
  expect(await createBackgroundSession({ ...options, enabled: async () => false, read: async () => ({ accessToken: 'fresh', expiresAtEpochSeconds: 200 }) })).toBeNull();
});
it('does not release an old token when logout finishes during the eligibility read', async () => {
  let session: StoredSession | null = { accessToken: 'current', refreshToken: 'identity', expiresAtEpochSeconds: 200 };
  const background = await createBackgroundSession({ read: async () => session, enabled: async () => { session = null; return true; }, now: () => 100 });
  expect(background).toBeNull();
});
