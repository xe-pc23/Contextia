import * as SecureStore from 'expo-secure-store';
import { parseStoredSession, type StoredSession } from './sessionModel';

const SESSION_STORAGE_KEY = 'contextia.cognito.session.v1';

export async function readSecureSession(): Promise<StoredSession | null> {
  const serialized = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
  if (serialized === null) return null;

  try {
    const parsed = parseStoredSession(JSON.parse(serialized) as unknown);
    if (parsed !== null) return parsed;
  } catch {
    // Corrupt local data is discarded; credentials are never logged.
  }
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
  return null;
}

export async function writeSecureSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function clearSecureSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}
