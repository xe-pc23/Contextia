import { z } from 'zod';
import { OpaqueIdSchema } from './context.js';
import { ProviderNeedSchema } from './enums.js';
import { GeocodedPlaceSchema, ProviderPlaceSchema, RouteSummarySchema, WeatherSnapshotSchema, providerResultSchema } from './enrichment.js';

// Transient, normalized evidence only. Structurally compatible with the provider port's enrichment.
// Event routes use eventId as anchorKey. Activity routes use placeId, with explicit origin/destination;
// supply both outward and return/onward routes rather than assuming a symmetric journey.
export const CandidateEvidenceSchema = z.strictObject({
  geocoding: z.array(z.strictObject({
    eventId: OpaqueIdSchema, result: providerResultSchema(GeocodedPlaceSchema.array())
  })).default([]),
  places: z.array(z.strictObject({
    need: ProviderNeedSchema.extract(['places-near-current', 'places-near-destination']),
    anchorKey: OpaqueIdSchema, result: providerResultSchema(ProviderPlaceSchema.array())
  })).default([]),
  weather: z.array(z.strictObject({
    need: ProviderNeedSchema.extract(['weather-current', 'weather-today']),
    result: providerResultSchema(WeatherSnapshotSchema)
  })).default([]),
  routes: z.array(z.strictObject({
    need: ProviderNeedSchema.extract(['route-to-next-event', 'route-to-place-candidates']),
    anchorKey: OpaqueIdSchema, result: providerResultSchema(RouteSummarySchema)
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
