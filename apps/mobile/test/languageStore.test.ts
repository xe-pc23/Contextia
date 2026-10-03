import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
  setItemAsync: vi.fn<(key: string, value: string, options?: unknown) => Promise<void>>(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only'
}));
vi.mock('expo-secure-store', () => native);

import { secureLanguageStore, UI_LANGUAGE_KEY } from '../src/i18n/languageStore';

describe('in-app display language store', () => {
  beforeEach(() => { native.getItemAsync.mockReset(); native.setItemAsync.mockReset(); });

  it('round-trips a supported language under its own key', async () => {
    native.setItemAsync.mockResolvedValue(undefined);
    await secureLanguageStore.write('en');
    expect(native.setItemAsync).toHaveBeenCalledWith(UI_LANGUAGE_KEY, 'en', { keychainAccessible: 'after-first-unlock-this-device-only' });
    native.getItemAsync.mockResolvedValue('en');
    await expect(secureLanguageStore.read()).resolves.toBe('en');
  });
  it('ignores unknown values and storage errors so the default language applies', async () => {
    native.getItemAsync.mockResolvedValueOnce('fr');
    await expect(secureLanguageStore.read()).resolves.toBeNull();
    native.getItemAsync.mockRejectedValueOnce(new Error('keychain'));
    await expect(secureLanguageStore.read()).resolves.toBeNull();
    native.setItemAsync.mockRejectedValueOnce(new Error('keychain'));
    await expect(secureLanguageStore.write('ja')).resolves.toBeUndefined();
  });
});
