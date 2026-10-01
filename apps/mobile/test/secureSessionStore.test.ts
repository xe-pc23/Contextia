import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('expo-secure-store', () => native);
import { createSecureSessionStore, sessionStorageKey } from '../src/auth/secureSessionStore';

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
});
