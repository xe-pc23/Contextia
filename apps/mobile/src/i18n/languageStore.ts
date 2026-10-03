import * as SecureStore from 'expo-secure-store';
import type { Language } from './messages';

/** Display-language choice only; not account data, so it survives sign-out and is shared across stages. */
export const UI_LANGUAGE_KEY = 'contextia.ui-language';

export type LanguageStore = { read: () => Promise<Language | null>; write: (language: Language) => Promise<void> };

export function parseLanguage(value: string | null): Language | null {
  return value === 'ja' || value === 'en' ? value : null;
}

export const secureLanguageStore: LanguageStore = {
  // A storage error must not block the app; it falls back to the default language.
  read: () => SecureStore.getItemAsync(UI_LANGUAGE_KEY).then(parseLanguage, () => null),
  write: language => SecureStore.setItemAsync(UI_LANGUAGE_KEY, language, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }).catch(() => undefined)
};
