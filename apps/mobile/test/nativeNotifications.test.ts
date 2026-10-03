import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  handler: null as null | { handleNotification: () => Promise<{ shouldShowBanner: boolean; shouldShowList: boolean }> }, appState: 'background', permission: vi.fn(), request: vi.fn(), schedule: vi.fn(), channel: vi.fn(), cancel: vi.fn(), dismiss: vi.fn(), cancelOne: vi.fn(), dismissOne: vi.fn(), lastResponse: vi.fn(), clearResponse: vi.fn(), listener: vi.fn()
}));
vi.mock('react-native', () => ({ AppState: { get currentState() { return native.appState; } }, Platform: { OS: 'android' } }));
vi.mock('expo-notifications', () => ({ setNotificationHandler: (handler: NonNullable<typeof native.handler>) => { native.handler = handler; }, getPermissionsAsync: native.permission, requestPermissionsAsync: native.request, scheduleNotificationAsync: native.schedule, setNotificationChannelAsync: native.channel, cancelAllScheduledNotificationsAsync: native.cancel, dismissAllNotificationsAsync: native.dismiss, cancelScheduledNotificationAsync: native.cancelOne, dismissNotificationAsync: native.dismissOne, getLastNotificationResponse: native.lastResponse, clearLastNotificationResponse: native.clearResponse, addNotificationResponseReceivedListener: native.listener, DEFAULT_ACTION_IDENTIFIER: 'default', AndroidImportance: { DEFAULT: 3 }, IosAuthorizationStatus: { PROVISIONAL: 3 } }));
import { clearDisplayedNotifications, notificationPermission, scheduleLocalNotification, subscribeToRecommendationNotifications } from '../src/notifications/nativeNotifications';
const notification = { identifier: 'contextia-rec', title: 'Contextia', body: 'A nearby suggestion', recommendationId: 'rec' };
beforeEach(() => { vi.resetAllMocks(); native.appState = 'background'; native.permission.mockResolvedValue({ granted: true }); native.schedule.mockResolvedValue('contextia-rec'); native.cancel.mockResolvedValue(undefined); native.dismiss.mockResolvedValue(undefined); native.cancelOne.mockResolvedValue(undefined); native.dismissOne.mockResolvedValue(undefined); });
it('schedules only ID data on the configured Android channel without a background prompt', async () => {
  await scheduleLocalNotification(notification);
  expect(native.schedule).toHaveBeenCalledWith({ identifier: 'contextia-rec', content: { title: 'Contextia', body: 'A nearby suggestion', data: { recommendationId: 'rec' } }, trigger: { channelId: 'contextia' } });
  expect(native.request).not.toHaveBeenCalled();
});
it('does not schedule if foreground or session revocation occurs during the permission read', async () => {
  native.permission.mockImplementation(async () => { native.appState = 'active'; return { granted: true }; });
  await expect(scheduleLocalNotification(notification)).rejects.toThrow();
  native.appState = 'background'; native.permission.mockResolvedValue({ granted: true });
  await expect(scheduleLocalNotification(notification, async () => false)).rejects.toThrow();
  expect(native.schedule).not.toHaveBeenCalled();
});
it('accepts iOS provisional permission and requests only on an explicit foreground action', async () => {
  native.permission.mockResolvedValue({ granted: false, canAskAgain: true, ios: { status: 3 } });
  expect(await notificationPermission()).toBe(true); expect(native.request).not.toHaveBeenCalled();
  native.permission.mockResolvedValue({ granted: false, canAskAgain: true }); native.request.mockResolvedValue({ granted: true });
  expect(await notificationPermission(true)).toBe(true);
});
it('keeps foreground arrivals out of the system notification list', async () => {
  native.appState = 'active';
  expect(await native.handler?.handleNotification()).toMatchObject({ shouldShowBanner: false, shouldShowList: false });
});
it('attempts dismissal even when cancellation of pending notifications fails', async () => {
  native.cancel.mockRejectedValue(new Error('OS cancellation'));
  await expect(clearDisplayedNotifications()).rejects.toThrow();
  expect(native.dismiss).toHaveBeenCalledOnce();
});
it('removes an old notification accepted after logout cleanup completes', async () => {
  let current = true; let release!: (id: string) => void;
  native.schedule.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
  const scheduling = scheduleLocalNotification(notification, async () => current);
  await vi.waitFor(() => expect(native.schedule).toHaveBeenCalledOnce());
  current = false; await clearDisplayedNotifications(); release('contextia-rec');
  await expect(scheduling).rejects.toThrow();
  expect(native.cancelOne).toHaveBeenCalledWith('contextia-rec'); expect(native.dismissOne).toHaveBeenCalledWith('contextia-rec');
});
it('does not request notification permission after logout during the permission metadata read', async () => {
  let current = true;
  native.permission.mockImplementation(async () => { current = false; return { granted: false, canAskAgain: true }; });
  expect(await notificationPermission(true, async () => current)).toBe(false);
  expect(native.request).not.toHaveBeenCalled();
});
it('opens cold and warm notification IDs once and stops after the signed-in screen unmounts', () => {
  const tap = { actionIdentifier: 'default', notification: { request: { identifier: 'contextia-rec', content: { data: { recommendationId: 'rec' } } } } };
  native.lastResponse.mockReturnValue(tap); const remove = vi.fn(); native.listener.mockReturnValue({ remove });
  const open = vi.fn(); const stop = subscribeToRecommendationNotifications(open);
  const callback = native.listener.mock.calls[0]![0] as (value: unknown) => void;
  callback(tap); expect(open).toHaveBeenCalledExactlyOnceWith('rec');
  callback({ ...tap, notification: { request: { identifier: 'contextia-rec2', content: { data: { recommendationId: 'rec2' } } } } });
  expect(open).toHaveBeenLastCalledWith('rec2');
  stop(); callback(tap); expect(open).toHaveBeenCalledTimes(2); expect(remove).toHaveBeenCalledOnce();
  expect(native.clearResponse).toHaveBeenCalledTimes(2);
});
it('ignores malformed and non-default notification actions and clears cold responses during logout', async () => {
  native.lastResponse.mockReturnValue({ actionIdentifier: 'custom', notification: { request: { content: { data: { recommendationId: 'private' } } } } });
  native.listener.mockReturnValue({ remove: vi.fn() }); const open = vi.fn(); const stop = subscribeToRecommendationNotifications(open);
  const callback = native.listener.mock.calls[0]![0] as (value: unknown) => void;
  callback({ actionIdentifier: 'default', notification: { request: { identifier: 'bad', content: { data: { recommendationId: {} } } } } });
  expect(open).not.toHaveBeenCalled(); stop();
  await clearDisplayedNotifications(); expect(native.clearResponse).toHaveBeenCalledOnce();
});
