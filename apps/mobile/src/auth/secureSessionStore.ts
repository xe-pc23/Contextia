import * as SecureStore from 'expo-secure-store';
import { parseStoredSession, type StoredSession } from './sessionModel';
import type { CognitoConfiguration } from './cognitoConfig';
import type { SessionStore } from './sessionManager';

export function sessionStorageKey(config: Pick<CognitoConfiguration, 'stage' | 'clientId'>): string {
  if (!/^[A-Za-z0-9_-]+$/.test(config.clientId)) throw new Error('Invalid mobile client ID');
  return `contextia.cognito.session.v2.${config.stage}.${config.clientId}`;
}

export function createSecureSessionStore(config: Pick<CognitoConfiguration, 'stage' | 'clientId'>): SessionStore {
  const key = sessionStorageKey(config);
  return {
    read: () => readSecureSession(key),
    write: session => SecureStore.setItemAsync(key, JSON.stringify(session)),
    clear: () => SecureStore.deleteItemAsync(key)
  };
}

async function readSecureSession(key: string): Promise<StoredSession | null> {
  const serialized = await SecureStore.getItemAsync(key);
  if (serialized === null) return null;

  try {
    const parsed = parseStoredSession(JSON.parse(serialized) as unknown);
    if (parsed !== null) return parsed;
  } catch {
    // Corrupt local data is discarded; credentials are never logged.
  }
  await SecureStore.deleteItemAsync(key);
  return null;
}
