import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { BackendClient } from '../api/backendClient';
import type { CognitoConfiguration } from '../auth/cognitoConfig';
import { readBackgroundSession } from '../auth/secureSessionStore';
import { clearDisplayedNotifications, notificationPermission } from '../notifications/nativeNotifications';
import { backgroundSessionIdentity } from './session';
import { backgroundSettingsKey, hashIdentity, LOCATION_TASK, readBackgroundSettings, writeBackgroundSettings } from './locationTask';

let generation = 0;
let operations: Promise<void> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = operations.catch(() => undefined).then(operation);
  operations = next.then(() => undefined, () => undefined);
  return next;
}
async function stopNative(failed = false): Promise<void> {
  try { if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK); }
  catch { failed = true; }
  await clearDisplayedNotifications().catch(() => { failed = true; });
  if (failed) throw new Error('Background cleanup incomplete');
}
async function clearEnrollment(config: CognitoConfiguration): Promise<void> {
  const failed = await SecureStore.deleteItemAsync(backgroundSettingsKey(config)).then(() => false, () => true);
  await stopNative(failed);
}
export function disableBackground(config: CognitoConfiguration): Promise<void> {
  // Invalidate immediately; order native start/stop so old work cannot stop a new enrollment.
  generation++;
  const deletion = SecureStore.deleteItemAsync(backgroundSettingsKey(config)).then(() => false, () => true);
  return serialize(async () => { await stopNative(await deletion); });
}

export async function backgroundEnabled(config: CognitoConfiguration): Promise<boolean> {
  const session = await readBackgroundSession(config);
  const settings = await readBackgroundSettings(config);
  return session !== null && settings !== null && settings.sessionIdentity === await hashIdentity(backgroundSessionIdentity(session)) && await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

/** Only called by a foreground button; headless callbacks never request permission. */
export function enableBackground(config: CognitoConfiguration, client: Pick<BackendClient, 'getProfile'>, signal?: AbortSignal): Promise<boolean> {
  const ownGeneration = ++generation;
  return serialize(() => enroll(config, client, signal, ownGeneration));
}
async function enroll(config: CognitoConfiguration, client: Pick<BackendClient, 'getProfile'>, signal: AbortSignal | undefined, ownGeneration: number): Promise<boolean> {
  const valid = () => !signal?.aborted && generation === ownGeneration;
  if (!valid() || !await TaskManager.isAvailableAsync() || !valid()) return false;
  const session = await readBackgroundSession(config);
  if (!session || session.expiresAtEpochSeconds <= Date.now() / 1000 + 30) return false;
  const identity = await hashIdentity(backgroundSessionIdentity(session));
  const eligible = async () => {
    if (!valid()) return false;
    const current = await readBackgroundSession(config);
    return current !== null && current.expiresAtEpochSeconds > Date.now() / 1000 + 30 && await hashIdentity(backgroundSessionIdentity(current)) === identity && valid();
  };
  const profile = await client.getProfile(signal);
  if (profile.kind !== 'success' || !profile.data.preferences.notificationsEnabled || !await eligible()) return false;
  if (!await notificationPermission(true, eligible) || !await eligible()) return false;
  if (!(await Location.requestForegroundPermissionsAsync()).granted || !await eligible()) return false;
  if (!(await Location.requestBackgroundPermissionsAsync()).granted || !await eligible()) return false;
  // A sign-out/account switch while the OS prompts were open cannot enable the old account.
  try {
    const namespace = await hashIdentity(`${config.stage}:${config.clientId}:${profile.data.userId}`);
    if (!await eligible()) return false;
    await writeBackgroundSettings(config, { sessionIdentity: identity, namespace });
    if (!await eligible()) { await clearEnrollment(config); return false; }
    await Location.startLocationUpdatesAsync(LOCATION_TASK, { accuracy: Location.Accuracy.Balanced, distanceInterval: 100,
      deferredUpdatesDistance: 100, pausesUpdatesAutomatically: true, showsBackgroundLocationIndicator: true,
      ...(Platform.OS === 'android' ? { foregroundService: { notificationTitle: 'Contextia', notificationBody: 'バックグラウンドで周辺の提案を確認しています', killServiceOnDestroy: true } } : {}) });
    if (!await eligible()) { await clearEnrollment(config); return false; }
    return true;
  } catch { await clearEnrollment(config).catch(() => undefined); return false; }
}
