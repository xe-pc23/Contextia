import { generateWeatherAdaptationCandidates } from './candidateGeneration.js';
import type { TriggerDetector } from './detectorContext.js';

// Weather is an enrichment need at this stage, not a fabricated weather observation.
// Call refineCandidates with real normalized evidence before invoking the model.
export const weatherAdaptationDetector: TriggerDetector = {
  type: 'WEATHER_ADAPTATION', async detect(input) { return generateWeatherAdaptationCandidates(input); }
};
