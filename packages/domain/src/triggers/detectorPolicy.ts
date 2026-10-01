import { DetectorPolicySchema } from '@contextia/contracts';
import type { DetectorPolicy } from '@contextia/contracts';

export type { DetectorPolicy } from '@contextia/contracts';

// Initial, tunable relevance heuristics. Delivery caps/dedup remain in DeliveryPolicy.
export const defaultDetectorPolicy: Readonly<DetectorPolicy> = Object.freeze({
  upcomingEventHorizonMinutes: 180,
  departureLeadMinutes: 10,
  arrivalBufferMinutes: 10,
  minimumGapMinutes: 30,
  minimumActivityMinutes: 15,
  maximumFreeTimeMinutes: 120,
  minimumEarlyArrivalMinutes: 30,
  earlyArrivalRadiusMeters: 300,
  minimumGeocodeConfidence: 0.8,
  routeEndpointToleranceMeters: 50,
  currentWeatherMaxAgeMinutes: 60,
  heatThresholdCelsius: 30,
  precipitationThresholdMillimeters: 0.1,
  precipitationProbabilityThreshold: 60
});

export function detectorPolicy(policy: Readonly<DetectorPolicy> = defaultDetectorPolicy): Readonly<DetectorPolicy> {
  return Object.freeze(DetectorPolicySchema.parse(policy));
}
