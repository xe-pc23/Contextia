import type { DetectorPolicy } from '@contextia/contracts';
import { generateUpcomingEventTransitCandidates } from './candidateGeneration.js';
import { defaultDetectorPolicy, detectorPolicy } from './detectorPolicy.js';
import type { TriggerDetector } from './detectorContext.js';

export function createUpcomingEventTransitDetector(policy: Readonly<DetectorPolicy> = defaultDetectorPolicy): TriggerDetector {
  const rules = detectorPolicy(policy);
  return { type: 'UPCOMING_EVENT_TRANSIT', async detect(input) { return generateUpcomingEventTransitCandidates(input, rules); } };
}
export const upcomingEventTransitDetector = createUpcomingEventTransitDetector();
