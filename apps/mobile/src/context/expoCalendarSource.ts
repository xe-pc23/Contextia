import * as Calendar from 'expo-calendar/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { getCalendarQueryWindow, getCalendarReadWindow } from './calendarWindow';
import { projectCalendarEvents } from './calendarProjection';
import type { CalendarReadResult, CalendarSource } from './types';

async function hashNativeEventId(nativeEventId: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nativeEventId);
  return `evt_${digest.slice(0, 40)}`;
}

export class ExpoCalendarSource implements CalendarSource {
  constructor(private readonly options: { requestPermissions?: boolean } = {}) {}
  async readUpcomingEvents(now: Date): Promise<CalendarReadResult> {
    try {
      const current = await Calendar.getCalendarPermissionsAsync();
      const permission = current.granted
        ? current
        : current.canAskAgain && this.options.requestPermissions !== false
          ? await Calendar.requestCalendarPermissionsAsync()
          : current;
      if (!permission.granted) return { status: 'denied' };

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const calendarIds = calendars.map(calendar => calendar.id).filter(id => id.length > 0);
      if (calendarIds.length === 0) return { status: 'granted', events: [] };

      const window = getCalendarReadWindow(now);
      const queryWindow = getCalendarQueryWindow(window);
      const nativeEvents: unknown[] = await Calendar.getEventsAsync(
        calendarIds,
        queryWindow.startInclusive,
        queryWindow.endExclusive
      );
      const platform = Platform.OS === 'android' ? 'android' : 'ios';
      const events = await projectCalendarEvents(nativeEvents, window, hashNativeEventId, platform);
      return { status: 'granted', events };
    } catch {
      return { status: 'unavailable' };
    }
  }
}
