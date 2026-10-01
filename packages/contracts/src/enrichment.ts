import { z } from 'zod';
import { GeoPointSchema, OpaqueIdSchema, TimestampSchema, TimezoneSchema } from './context.js';
import { ProviderStatusValueSchema } from './enums.js';
import { PlaceSchema, RecommendationRouteSchema } from './recommendation.js';

const statusFields = { latencyMs: z.number().nonnegative().optional(), code: z.string().min(1).max(128).optional() };
export const ProviderStatusSchema = z.strictObject({ status: ProviderStatusValueSchema, ...statusFields });
export const ProviderStatusMapSchema = z.strictObject({
  geocoding: ProviderStatusSchema, places: ProviderStatusSchema, weather: ProviderStatusSchema,
  routes: ProviderStatusSchema, bedrock: ProviderStatusSchema
});
export function providerResultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion('status', [
    z.strictObject({ status: z.enum(['ok', 'degraded']), data: dataSchema, ...statusFields }),
    z.strictObject({ status: z.enum(['unavailable', 'timeout', 'error', 'not_requested']), data: z.null(), ...statusFields })
  ]);
}
export type ProviderResult<T> = (
  | { status: 'ok' | 'degraded'; data: T }
  | { status: 'unavailable' | 'timeout' | 'error' | 'not_requested'; data: null }
) & Pick<z.infer<typeof ProviderStatusSchema>, 'latencyMs' | 'code'>;
export const GeocodedPlaceSchema = PlaceSchema.extend({ confidence: z.number().min(0).max(1) });
export const WeatherConditionSchema = z.enum(['clear', 'cloudy', 'rain', 'snow', 'storm', 'unknown']);
const weatherFields = {
  condition: WeatherConditionSchema, temperatureCelsius: z.number().nullable(),
  precipitationProbability: z.number().min(0).max(100).nullable(), precipitationMillimeters: z.number().nonnegative().nullable()
};
export const WeatherWindowSchema = z.strictObject({ startAt: TimestampSchema, endAt: TimestampSchema, ...weatherFields }).refine(
  value => Date.parse(value.endAt) >= Date.parse(value.startAt), { path: ['endAt'], message: 'endAt must be at or after startAt' }
);
export const WeatherSnapshotSchema = z.strictObject({ at: TimestampSchema, timezone: TimezoneSchema, ...weatherFields, forecast: z.array(WeatherWindowSchema) });
export const RouteLegSchema = z.strictObject({
  mode: z.enum(['pedestrian', 'bus', 'rail', 'subway', 'tram', 'ferry', 'other']),
  durationMinutes: z.number().nonnegative(), departAt: TimestampSchema.optional(), arriveAt: TimestampSchema.optional(),
  lineName: z.string().min(1).optional()
});
export const RouteSummarySchema = RecommendationRouteSchema.extend({
  routeId: OpaqueIdSchema, origin: GeoPointSchema, destination: GeoPointSchema,
  distanceMeters: z.number().nonnegative().optional(), legs: z.array(RouteLegSchema), warnings: z.array(z.string())
});

export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export type ProviderStatusMap = z.infer<typeof ProviderStatusMapSchema>;
export type GeocodedPlace = z.infer<typeof GeocodedPlaceSchema>;
export type WeatherSnapshot = z.infer<typeof WeatherSnapshotSchema>;
export type RouteSummary = z.infer<typeof RouteSummarySchema>;
