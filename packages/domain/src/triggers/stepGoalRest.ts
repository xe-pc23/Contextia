import { CandidateOpportunitySchema } from '@contextia/contracts';
import { localDate } from '../context/timezone.js';
import type { DetectorContext, TriggerDetector } from './detectorContext.js';

export function generateStepGoalRestCandidates(input: DetectorContext) {
  const stepsToday = input.activity?.stepsToday;
  if (stepsToday === undefined || stepsToday === null || stepsToday < input.stepGoal) return [];
  const stepConfidence = input.activity?.confidence;
  // Preserve low-confidence evidence for relevance evaluation, rather than globally suppressing it.
  const confidence = stepConfidence === 'high' ? 1 : stepConfidence === 'low' ? 0.5 : 0.75;
  return [CandidateOpportunitySchema.parse({
    type: 'STEP_GOAL_REST',
    confidence,
    anchorKey: localDate(input.evaluationAt, input.timezone),
    requiredSignals: ['steps', 'location', 'time'],
    providerNeeds: ['places-near-current'],
    facts: {
      stepsToday,
      stepGoal: input.stepGoal,
      stepGoalReached: true,
      ...(stepConfidence ? { stepConfidence } : {}),
      ...(input.activity?.stepSource ? { stepSource: input.activity.stepSource } : {})
    }
  })];
}

export const stepGoalRestDetector: TriggerDetector = {
  type: 'STEP_GOAL_REST',
  async detect(input) { return generateStepGoalRestCandidates(input); }
};
