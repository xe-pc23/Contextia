import type { DetectorPolicy } from '@contextia/contracts';
import { generateEarlyArrivalDetourCandidates } from './candidateGeneration.js';
import { defaultDetectorPolicy, detectorPolicy } from './detectorPolicy.js';
import type { TriggerDetector } from './detectorContext.js';

export function createEarlyArrivalDetourDetector(policy: Readonly<DetectorPolicy> = defaultDetectorPolicy): TriggerDetector {
  const rules = detectorPolicy(policy);
  return { type: 'EARLY_ARRIVAL_DETOUR', async detect(input) { return generateEarlyArrivalDetourCandidates(input, rules); } };
}
export const earlyArrivalDetourDetector = createEarlyArrivalDetourDetector();
