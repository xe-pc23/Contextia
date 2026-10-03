import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import type { LocalNotification } from './localDelivery';
import { z } from 'zod';
const isAppActive = (): boolean => AppState.currentState === 'active';

Notifications.setNotificationHandler({ handleNotification: async () => {
  const visible = !isAppActive();
  return { shouldShowBanner: visible, shouldShowList: visible, shouldPlaySound: false, shouldSetBadge: false };
} });

export async function notificationPermission(request = false, isCurrent: () => Promise<boolean> = async () => true): Promise<boolean> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('contextia', { name: 'Contextia suggestions', importance: Notifications.AndroidImportance.DEFAULT });
  const current = await Notifications.getPermissionsAsync();
  if (!await isCurrent()) return false;
  const permission = request && !current.granted && current.canAskAgain ? await Notifications.requestPermissionsAsync() : current;
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function scheduleLocalNotification(value: LocalNotification, isCurrent: () => Promise<boolean> = async () => true): Promise<void> {
  if (isAppActive() || !await notificationPermission()) throw new Error('Notification not eligible');
  // Permission checks may yield while the user opens the app.
  if (!await isCurrent() || isAppActive()) throw new Error('App is active or session ended');
  const identifier = await Notifications.scheduleNotificationAsync({ identifier: value.identifier,
    content: { title: value.title, body: value.body, data: { recommendationId: value.recommendationId } },
    trigger: Platform.OS === 'android' ? { channelId: 'contextia' } : null });
  if (!await isCurrent() || isAppActive()) {
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
    await Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
    throw new Error('Notification eligibility ended');
  }
}

export async function clearDisplayedNotifications(): Promise<void> {
  let failed = false;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => { failed = true; });
  await Notifications.dismissAllNotificationsAsync().catch(() => { failed = true; });
  try { Notifications.clearLastNotificationResponse(); } catch { failed = true; }
  if (failed) throw new Error('Notification cleanup incomplete');
}

const OpenResponseSchema = z.object({ actionIdentifier: z.string(), notification: z.object({ request: z.object({
  identifier: z.string().min(1).max(256), content: z.object({ data: z.object({ recommendationId: z.string().min(1).max(128) }) })
}) }) });
/** Mounted only by the authenticated screen. The owned detail API verifies the ID again. */
export function subscribeToRecommendationNotifications(open: (id: string) => void): () => void {
  let active = true; let lastIdentifier: string | null = null;
  const consume = (value: unknown) => {
    const response = OpenResponseSchema.safeParse(value);
    if (!active || !response.success || response.data.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const request = response.data.notification.request;
    if (lastIdentifier === request.identifier) return;
    lastIdentifier = request.identifier;
    try { Notifications.clearLastNotificationResponse(); } catch { /* Owned reads still fence a stale response. */ }
    open(request.content.data.recommendationId);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(consume);
  try { consume(Notifications.getLastNotificationResponse()); } catch { /* Some OS versions cannot restore a response. */ }
  return () => { active = false; subscription.remove(); };
}
