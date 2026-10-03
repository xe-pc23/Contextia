import type { CandidateOpportunity, DetectorPolicy } from '@contextia/contracts';
import type { DetectorContext, TriggerDetector } from './detectorContext.js';
import { defaultDetectorPolicy } from './detectorPolicy.js';
import { createUpcomingEventTransitDetector } from './upcomingEventTransit.js';
import { createFreeTimeNearbyDetector } from './freeTimeNearby.js';
import { weatherAdaptationDetector } from './weatherAdaptation.js';
import { createEarlyArrivalDetourDetector } from './earlyArrivalDetour.js';
import { stepGoalRestDetector } from './stepGoalRest.js';

export function createDetectorRegistry(policy: Readonly<DetectorPolicy> = defaultDetectorPolicy): readonly TriggerDetector[] {
  return Object.freeze([
    createUpcomingEventTransitDetector(policy), stepGoalRestDetector, createFreeTimeNearbyDetector(policy),
    weatherAdaptationDetector, createEarlyArrivalDetourDetector(policy)
  ]);
}

export const phase2Detectors = createDetectorRegistry();

// These are provisional candidates/provider needs. Refine after enrichment, before Bedrock.
export async function detectCandidates(input: DetectorContext, detectors: readonly TriggerDetector[] = phase2Detectors): Promise<CandidateOpportunity[]> {
  const detected = await Promise.all(detectors.map(detector => detector.detect(input)));
  const unique = new Map<string, CandidateOpportunity>();
  for (const candidate of detected.flat()) {
    if (input.calendarStatus !== undefined && input.calendarStatus !== 'granted' && candidate.requiredSignals.includes('calendar')) continue;
    const key = JSON.stringify([candidate.type, candidate.anchorKey]);
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}
