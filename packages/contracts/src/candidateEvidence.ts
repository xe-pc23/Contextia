import { z } from 'zod';
import { OpaqueIdSchema, TimestampSchema } from './context.js';
import { ProviderNeedSchema } from './enums.js';
import { GeocodedPlaceSchema, ProviderPlaceSchema, RouteSummarySchema, WeatherSnapshotSchema, providerResultSchema } from './enrichment.js';

export const CURRENT_PLACE_ANCHOR = 'current';

// Transient evidence: detectCandidates -> attempt declared provider needs -> refineCandidates -> model.
// places-near-current uses CURRENT_PLACE_ANCHOR; places-near-destination uses the destination eventId.
// Event routes use eventId; activity routes use placeId and explicit endpoints in both directions.
// For route-to-next-event, record the actual RouteProvider request's arriveBy (event start minus buffer).
// Only arrival-planned results with both provider timestamps can prove the latest practical departure.
// Departure-now results and duration-only transit must not be presented as an arrival-optimized timetable.
export const CandidateEvidenceSchema = z.strictObject({
  geocoding: z.array(z.strictObject({
    eventId: OpaqueIdSchema, result: providerResultSchema(GeocodedPlaceSchema.array())
  })).default([]),
  places: z.array(z.strictObject({
    need: ProviderNeedSchema.extract(['places-near-current', 'places-near-destination']),
    anchorKey: OpaqueIdSchema, result: providerResultSchema(ProviderPlaceSchema.array())
  }).superRefine((entry, ctx) => {
    if (entry.need === 'places-near-current' && entry.anchorKey !== CURRENT_PLACE_ANCHOR) {
      ctx.addIssue({ code: 'custom', path: ['anchorKey'], message: 'places-near-current must use the current anchor' });
    }
  })).default([]),
  weather: z.array(z.strictObject({
    need: ProviderNeedSchema.extract(['weather-current', 'weather-today']),
    result: providerResultSchema(WeatherSnapshotSchema)
  })).default([]),
  routes: z.array(z.strictObject({
    need: ProviderNeedSchema.extract(['route-to-next-event', 'route-to-place-candidates']),
    anchorKey: OpaqueIdSchema, arriveBy: TimestampSchema.optional(), result: providerResultSchema(RouteSummarySchema)
  })).default([])
});

// Candidate heuristics are injectable; these do not replace deterministic delivery guards.
export const DetectorPolicySchema = z.strictObject({
  upcomingEventHorizonMinutes: z.number().positive().finite(),
  departureLeadMinutes: z.number().nonnegative().finite(),
  arrivalBufferMinutes: z.number().nonnegative().finite(),
  minimumGapMinutes: z.number().positive().finite(),
  minimumActivityMinutes: z.number().positive().finite(),
  maximumFreeTimeMinutes: z.number().positive().finite(),
  minimumEarlyArrivalMinutes: z.number().positive().finite(),
  earlyArrivalRadiusMeters: z.number().positive().finite(),
  minimumGeocodeConfidence: z.number().min(0).max(1),
  routeEndpointToleranceMeters: z.number().positive().finite(),
  currentWeatherMaxAgeMinutes: z.number().positive().finite(),
  heatThresholdCelsius: z.number().finite(),
  precipitationThresholdMillimeters: z.number().positive().finite(),
  precipitationProbabilityThreshold: z.number().positive().max(100)
}).refine(value => value.maximumFreeTimeMinutes >= value.minimumGapMinutes, {
  path: ['maximumFreeTimeMinutes'], message: 'Maximum free time must cover the minimum gap'
});

export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>;
export type DetectorPolicy = z.infer<typeof DetectorPolicySchema>;
