import { beforeEach, expect, it, vi } from 'vitest';
import type { CognitoConfiguration } from '../src/auth/cognitoConfig';
import { profile } from './support/data';
const native = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), delete: vi.fn(), started: vi.fn(), start: vi.fn(), stop: vi.fn(), foreground: vi.fn(), background: vi.fn(), available: vi.fn(), notify: vi.fn(), clear: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-location', () => ({ Accuracy: { Balanced: 3 }, hasStartedLocationUpdatesAsync: native.started, startLocationUpdatesAsync: native.start, stopLocationUpdatesAsync: native.stop, requestForegroundPermissionsAsync: native.foreground, requestBackgroundPermissionsAsync: native.background }));
vi.mock('expo-task-manager', () => ({ isAvailableAsync: native.available }));
vi.mock('expo-secure-store', () => ({ deleteItemAsync: native.delete }));
vi.mock('../src/auth/secureSessionStore', () => ({ readBackgroundSession: native.read }));
vi.mock('../src/notifications/nativeNotifications', () => ({ notificationPermission: native.notify, clearDisplayedNotifications: native.clear }));
vi.mock('../src/background/locationTask', () => ({ LOCATION_TASK: 'task', backgroundSettingsKey: () => 'key', hashIdentity: async (value: string) => value, writeBackgroundSettings: native.write, readBackgroundSettings: async () => null }));
import { disableBackground, enableBackground } from '../src/background/control';
const config: CognitoConfiguration = { stage: 'dev', scheme: 'contextia-dev', clientId: 'client', issuer: 'https://issuer.example', redirectUri: 'contextia-dev://auth/callback' };
const client = { getProfile: async () => ({ kind: 'success' as const, requestId: 'req', data: profile }) };
beforeEach(() => {
  vi.resetAllMocks(); native.read.mockResolvedValue({ accessToken: 'token', refreshToken: 'identity', expiresAtEpochSeconds: Date.now() / 1000 + 3600 });
  native.available.mockResolvedValue(true); native.foreground.mockResolvedValue({ granted: true }); native.background.mockResolvedValue({ granted: true }); native.notify.mockResolvedValue(true); native.started.mockResolvedValue(true); native.delete.mockResolvedValue(undefined); native.clear.mockResolvedValue(undefined); native.start.mockResolvedValue(undefined);
});
it('enrolls explicitly with a stable stage/client/user namespace and no fixed callback interval', async () => {
  expect(await enableBackground(config, client)).toBe(true);
  expect(native.write).toHaveBeenCalledWith(config, { sessionIdentity: 'identity', namespace: 'dev:client:user-test' });
  expect(native.start.mock.calls[0]?.[1]).toMatchObject({ distanceInterval: 100, showsBackgroundLocationIndicator: true });
  expect(native.start.mock.calls[0]?.[1]).not.toHaveProperty('timeInterval');
});
it('does not enable an old session when sign-out aborts during OS permission prompts', async () => {
  const controller = new AbortController();
  native.background.mockImplementation(async () => { controller.abort(); return { granted: true }; });
  expect(await enableBackground(config, client, controller.signal)).toBe(false);
  expect(native.write).not.toHaveBeenCalled(); expect(native.start).not.toHaveBeenCalled();
});
it('does not open later permission prompts after logout during notification authorization', async () => {
  const controller = new AbortController();
  native.notify.mockImplementation(async () => { controller.abort(); return true; });
  expect(await enableBackground(config, client, controller.signal)).toBe(false);
  expect(native.foreground).not.toHaveBeenCalled(); expect(native.background).not.toHaveBeenCalled();
});
it('does not start location for denied notifications or changed credentials', async () => {
  native.notify.mockResolvedValue(false); expect(await enableBackground(config, client)).toBe(false);
  native.notify.mockResolvedValue(true); native.background.mockImplementation(async () => { native.read.mockResolvedValue(null); return { granted: true }; });
  expect(await enableBackground(config, client)).toBe(false); expect(native.write).not.toHaveBeenCalled();
});
it('attempts native stop and notification cleanup even if stored opt-in deletion fails', async () => {
  native.delete.mockRejectedValue(new Error('disk'));
  await expect(disableBackground(config)).rejects.toThrow();
  expect(native.stop).toHaveBeenCalledWith('task'); expect(native.clear).toHaveBeenCalledOnce();
});
it('keeps a new enrollment when an old native start finishes after logout and another login', async () => {
  let saved: unknown = null;
  native.write.mockImplementation(async (_config, value: unknown) => { saved = value; });
  native.delete.mockImplementation(async () => { saved = null; });
  let release!: () => void;
  native.start.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const old = enableBackground(config, client);
  await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce());
  const stopping = disableBackground(config);
  native.read.mockResolvedValue({ accessToken: 'new-token', refreshToken: 'new-identity', expiresAtEpochSeconds: Date.now() / 1000 + 3600 });
  const newer = enableBackground(config, { getProfile: async () => ({ kind: 'success', requestId: 'req', data: { ...profile, userId: 'new-user' } }) });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  release();
  expect(await old).toBe(false); await stopping; expect(await newer).toBe(true);
  expect(saved).toEqual({ sessionIdentity: 'new-identity', namespace: 'dev:client:new-user' });
});
