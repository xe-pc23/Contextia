import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(), AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 3 }));
vi.mock('expo-secure-store', () => native);
import { createSecureSessionStore, readBackgroundSession, sessionStorageKey } from '../src/auth/secureSessionStore';

describe('stage-specific secure sessions', () => {
  beforeEach(() => vi.resetAllMocks());
  it('isolates dev, prod, and distinct mobile clients', () => {
    const keys = [
      sessionStorageKey({ stage: 'dev', clientId: 'clientA' }),
      sessionStorageKey({ stage: 'prod', clientId: 'clientA' }),
      sessionStorageKey({ stage: 'dev', clientId: 'clientB' })
    ];
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(key => /^[\w.-]+$/.test(key))).toBe(true);
  });
  it('reads only its configured client and removes corrupt stored values', async () => {
    native.getItemAsync.mockResolvedValue('{"accessToken":"private","expiresAtEpochSeconds":"invalid"}');
    const config = { stage: 'dev' as const, clientId: 'clientA' };
    expect(await createSecureSessionStore(config).read()).toBeNull();
    expect(native.getItemAsync).toHaveBeenCalledWith(sessionStorageKey(config));
    expect(native.deleteItemAsync).toHaveBeenCalledWith(sessionStorageKey(config));
  });
  it('writes device-only credentials accessible after unlock and never mutates them from a background read', async () => {
    const config = { stage: 'dev' as const, clientId: 'clientA' };
    await createSecureSessionStore(config).write({ accessToken: 'token', expiresAtEpochSeconds: 99999 });
    expect(native.setItemAsync).toHaveBeenCalledWith(sessionStorageKey(config), expect.any(String), { keychainAccessible: 3 });
    native.getItemAsync.mockResolvedValue('corrupt');
    expect(await readBackgroundSession(config)).toBeNull();
    expect(native.deleteItemAsync).not.toHaveBeenCalled();
    native.getItemAsync.mockRejectedValue(new Error('locked'));
    await expect(readBackgroundSession(config)).rejects.toThrow('locked');
    expect(native.deleteItemAsync).not.toHaveBeenCalled();
  });
});
