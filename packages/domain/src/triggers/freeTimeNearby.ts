import type { DetectorPolicy } from '@contextia/contracts';
import { generateFreeTimeNearbyCandidates } from './candidateGeneration.js';
import { defaultDetectorPolicy, detectorPolicy } from './detectorPolicy.js';
import type { TriggerDetector } from './detectorContext.js';

export function createFreeTimeNearbyDetector(policy: Readonly<DetectorPolicy> = defaultDetectorPolicy): TriggerDetector {
  const rules = detectorPolicy(policy);
  return { type: 'FREE_TIME_NEARBY', async detect(input) { return generateFreeTimeNearbyCandidates(input, rules); } };
}
export const freeTimeNearbyDetector = createFreeTimeNearbyDetector();
