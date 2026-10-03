import { z } from 'zod';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { apiBaseUrl, createBackendClient } from '../api/backendClient';
import { readCognitoConfiguration, type CognitoConfiguration } from '../auth/cognitoConfig';
import { readBackgroundSession } from '../auth/secureSessionStore';
import { ContextCollector, SystemClock } from '../context/contextCollector';
import { ExpoCalendarSource } from '../context/expoCalendarSource';
import { createNativeStepSource } from '../context/nativeSteps';
import { LocalDelivery } from '../notifications/localDelivery';
import { createSqliteClaimStore } from '../notifications/sqliteClaims';
import { scheduleLocalNotification } from '../notifications/nativeNotifications';
import { BackgroundEvaluation, latestCallbackLocation } from './evaluate';
import { createBackgroundSession } from './session';

export const LOCATION_TASK = 'contextia-location-v1';
const SettingsSchema = z.strictObject({ sessionIdentity: z.string().regex(/^[a-f0-9]{64}$/), namespace: z.string().regex(/^[a-f0-9]{64}$/) });
export type BackgroundSettings = z.infer<typeof SettingsSchema>;
export function backgroundSettingsKey(config: CognitoConfiguration): string { return `contextia.background.v1.${config.stage}.${config.clientId}`; }
export const hashIdentity = (value: string): Promise<string> => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
export async function readBackgroundSettings(config: CognitoConfiguration): Promise<BackgroundSettings | null> {
  const raw = await SecureStore.getItemAsync(backgroundSettingsKey(config));
  if (raw === null) return null;
  try { const parsed = SettingsSchema.safeParse(JSON.parse(raw) as unknown); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
export async function writeBackgroundSettings(config: CognitoConfiguration, settings: BackgroundSettings): Promise<void> {
  await SecureStore.setItemAsync(backgroundSettingsKey(config), JSON.stringify(SettingsSchema.parse(settings)), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}
let callbacks: Promise<void> = Promise.resolve();
TaskManager.defineTask(LOCATION_TASK, async ({ data, error, executionInfo }) => {
  if (error || executionInfo.appState === 'active') return;
  // The payload stays only in memory; no location history or errors are logged.
  const next = callbacks.catch(() => undefined).then(() => runLocationCallback(data)).catch(() => undefined);
  callbacks = next;
  return next;
});

async function runLocationCallback(payload: unknown): Promise<void> {
  if (AppState.currentState === 'active') return;
  const config = readCognitoConfiguration({
    EXPO_PUBLIC_STAGE: process.env.EXPO_PUBLIC_STAGE, EXPO_PUBLIC_COGNITO_ISSUER: process.env.EXPO_PUBLIC_COGNITO_ISSUER,
    EXPO_PUBLIC_COGNITO_CLIENT_ID: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID, EXPO_PUBLIC_COGNITO_REDIRECT_URI: process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI
  });
  const baseUrl = apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  const location = latestCallbackLocation(payload, new Date());
  if (!config || !baseUrl || !location) return;
  const settings = await readBackgroundSettings(config);
  if (!settings) return;
  const session = await createBackgroundSession({ read: () => readBackgroundSession(config), now: () => Date.now() / 1000,
    enabled: async identity => {
      if (AppState.currentState === 'active' || !(await Location.getBackgroundPermissionsAsync()).granted) return false;
      const current = await readBackgroundSettings(config);
      return current?.sessionIdentity === await hashIdentity(identity) && current.namespace === settings.namespace;
    } });
  if (!session) return;
  const client = createBackendClient({ baseUrl, getAccessToken: session.getAccessToken, createIdempotencyKey: Crypto.randomUUID });
  const sqlite = await import('expo-sqlite');
  const db = await sqlite.openDatabaseAsync('contextia-delivery.db');
  try {
    const collector = new ContextCollector({ readCurrentLocation: async () => ({ status: 'granted', location }) }, new ExpoCalendarSource({ requestPermissions: false }), new SystemClock(), createNativeStepSource({ background: true }));
    const delivery = new LocalDelivery({ store: createSqliteClaimStore(db, settings.namespace), now: () => new Date(),
      isCurrent: session.isCurrent, notify: async value => {
        if (!await session.isCurrent()) throw new Error('Session ended');
        const currentProfile = await client.getProfile();
        if (currentProfile.kind !== 'success' || !currentProfile.data.preferences.notificationsEnabled || !await session.isCurrent()) throw new Error('Notifications disabled');
        await scheduleLocalNotification(value, session.isCurrent);
      } });
    await new BackgroundEvaluation({ isCurrent: session.isCurrent,
      profile: async () => {
        const profile = await client.getProfile();
        if (profile.kind === 'success' && await hashIdentity(`${config.stage}:${config.clientId}:${profile.data.userId}`) !== settings.namespace) return { kind: 'unauthenticated' };
        return profile;
      },
      collect: profile => collector.collect(profile.preferences.stepGoal, profile.preferences.timezone),
      evaluate: input => client.evaluate(input), deliver: async value => { await delivery.deliver(value, 'background'); }
    }).run();
  } finally { await db.closeAsync(); }
}
