import { z } from 'zod';

export const SignalNameSchema = z.enum(['time', 'location', 'calendar', 'steps', 'weather', 'places', 'transit', 'preferences']);
export const TriggerTypeSchema = z.enum(['UPCOMING_EVENT_TRANSIT', 'STEP_GOAL_REST', 'FREE_TIME_NEARBY', 'WEATHER_ADAPTATION', 'EARLY_ARRIVAL_DETOUR']);
export const DeliveryModeSchema = z.enum(['proactive', 'preview']);
export const ProviderNeedSchema = z.enum(['geocode-event-location', 'places-near-current', 'places-near-destination', 'weather-current', 'weather-today', 'route-to-next-event', 'route-to-place-candidates']);
export const ProviderStatusValueSchema = z.enum(['ok', 'degraded', 'unavailable', 'timeout', 'error', 'not_requested']);
export const GuardCodeSchema = z.enum(['NOTIFICATIONS_DISABLED', 'DAILY_CAP_REACHED', 'DUPLICATE_CONTEXT', 'RECENT_SAME_TRIGGER', 'NO_CANDIDATE', 'NO_MEANINGFUL_OPPORTUNITY']);
export const DeliveryGuardCodeSchema = GuardCodeSchema.extract(['NOTIFICATIONS_DISABLED', 'DAILY_CAP_REACHED', 'DUPLICATE_CONTEXT', 'RECENT_SAME_TRIGGER']);
export const CandidateDiagnosticCodeSchema = z.enum(['MISSING_REQUIRED_SIGNAL', 'PROVIDER_UNAVAILABLE', 'GEOCODE_AMBIGUOUS']);
export const UrgencySchema = z.enum(['low', 'medium', 'high']);
export const RouteModeSchema = z.enum(['transit', 'intermodal', 'pedestrian']);
export const PersistenceIntentSchema = z.enum(['single-use', 'storage']);
export const ScenarioIdSchema = z.enum(['upcoming-transit', 'step-goal', 'free-time', 'weather-adaptation', 'early-arrival']);

export type SignalName = z.infer<typeof SignalNameSchema>;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;
export type ProviderNeed = z.infer<typeof ProviderNeedSchema>;
export type ProviderStatusValue = z.infer<typeof ProviderStatusValueSchema>;
export type GuardCode = z.infer<typeof GuardCodeSchema>;
export type DeliveryGuardCode = z.infer<typeof DeliveryGuardCodeSchema>;
export type CandidateDiagnosticCode = z.infer<typeof CandidateDiagnosticCodeSchema>;
export type Urgency = z.infer<typeof UrgencySchema>;
export type RouteMode = z.infer<typeof RouteModeSchema>;
export type PersistenceIntent = z.infer<typeof PersistenceIntentSchema>;
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
