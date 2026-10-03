import { expect, it, vi } from 'vitest';
const calendar = vi.hoisted(() => ({ getCalendarPermissionsAsync: vi.fn(), requestCalendarPermissionsAsync: vi.fn(), getCalendarsAsync: vi.fn(), getEventsAsync: vi.fn(), EntityTypes: { EVENT: 'event' } }));
vi.mock('expo-calendar/legacy', () => calendar);
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async () => 'hashed' }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
import { ExpoCalendarSource } from '../src/context/expoCalendarSource';

it('does not request calendar authorization from a background read', async () => {
  calendar.getCalendarPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  calendar.requestCalendarPermissionsAsync.mockResolvedValue({ granted: true });
  calendar.getCalendarsAsync.mockResolvedValue([]);
  expect(await new ExpoCalendarSource({ requestPermissions: false }).readUpcomingEvents(new Date())).toEqual({ status: 'denied' });
  expect(calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
});
