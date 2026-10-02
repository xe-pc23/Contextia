import { z } from 'zod';

export const OpaqueIdSchema = z.string().min(1);
export const CalendarDateSchema = z.iso.date();
export const TimestampSchema = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), 'Invalid timestamp');
export const TimezoneSchema = z.string().min(1).max(64).refine(value => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return !/^[+-]/.test(value);
  } catch {
    return false;
  }
}, 'Expected an IANA timezone');
export const GeoPointSchema = z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
export const LocationContextSchema = GeoPointSchema.extend({
  accuracyMeters: z.number().min(0).max(100_000).optional(),
  capturedAt: TimestampSchema,
  source: z.enum(['gps', 'scenario'])
});
export const CalendarEventContextSchema = z.strictObject({
  id: z.string().min(1).max(128), title: z.string().min(1).max(200),
  startAt: TimestampSchema, endAt: TimestampSchema,
  location: z.string().max(200).nullable().optional(), allDay: z.boolean().optional()
}).superRefine((event, ctx) => {
  const duration = Date.parse(event.endAt) - Date.parse(event.startAt);
  if (duration < 0) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'endAt must be at or after startAt' });
  if (!event.allDay && duration > 31 * 24 * 60 * 60 * 1000) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Non-all-day events must not exceed 31 days' });
});
export const ActivityContextSchema = z.strictObject({
  stepsToday: z.number().int().min(0).max(200_000).nullable().optional(),
  stepGoal: z.number().int().min(1).max(200_000).nullable().optional(),
  stepGoalReached: z.boolean().optional(),
  stepSource: z.enum(['ios-pedometer', 'android-health-connect', 'foreground-sensor', 'scenario']).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional()
});
export const UserPreferencesSchema = z.strictObject({
  interests: z.array(z.string().min(1).max(64)).max(20),
  stepGoal: z.number().int().min(1).max(200_000),
  notificationFrequency: z.enum(['low', 'normal', 'high']), notificationsEnabled: z.boolean(),
  locale: z.string().min(2).max(35), timezone: TimezoneSchema
});
const contextFields = {
  capturedAt: TimestampSchema, scenarioTime: TimestampSchema.optional(), location: LocationContextSchema,
  activity: ActivityContextSchema.optional(), calendar: z.array(CalendarEventContextSchema).max(100),
  preferencesOverride: UserPreferencesSchema.partial().optional()
};
export const RealContextInputSchema = z.strictObject({ ...contextFields, mode: z.literal('real'), deliveryMode: z.literal('proactive') });
export const ScenarioContextInputSchema = z.strictObject({ ...contextFields, mode: z.literal('simulation'), deliveryMode: z.literal('preview') });
export const ContextInputSchema = z.discriminatedUnion('mode', [RealContextInputSchema, ScenarioContextInputSchema]);

export type GeoPoint = z.infer<typeof GeoPointSchema>;
export type LocationContext = z.infer<typeof LocationContextSchema>;
export type CalendarEventContext = z.infer<typeof CalendarEventContextSchema>;
export type ActivityContext = z.infer<typeof ActivityContextSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
/** A fresh schema-validated starting profile; clients display only preferences acknowledged by the API. */
export function createDefaultUserPreferences(): UserPreferences {
  return UserPreferencesSchema.parse({ interests: ['cafe', 'park'], stepGoal: 10_000,
    notificationFrequency: 'normal', notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo' });
}
export type ContextInput = z.infer<typeof ContextInputSchema>;
export type ScenarioContextInput = z.infer<typeof ScenarioContextInputSchema>;
