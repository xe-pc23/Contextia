import { earlyArrival } from '../scenarios/early-arrival.js';
import { freeTime } from '../scenarios/free-time.js';
import { stepGoal } from '../scenarios/step-goal.js';
import { upcomingTransit } from '../scenarios/upcoming-transit.js';
import { weatherAdaptation } from '../scenarios/weather-adaptation.js';
import type { ScenarioContextInput, ScenarioId } from '@contextia/contracts';
import type { ScenarioFixture } from './types.js';

export type { ScenarioFixture } from './types.js';
export { stepGoal, stepGoalBelowGoal, stepGoalStepsUnavailable } from '../scenarios/step-goal.js';
export const scenarios: readonly ScenarioFixture[] = [upcomingTransit, stepGoal, freeTime, weatherAdaptation, earlyArrival];

// Console presets supply inputs only. Mock enrichments are exclusively test data.
export function getScenarioInput(id: ScenarioId): ScenarioContextInput {
  const fixture = scenarios.find(value => value.id === id);
  if (!fixture) throw new Error('Unknown predefined scenario');
  return structuredClone({ ...fixture.context, preferencesOverride: { ...fixture.preferences, ...fixture.context.preferencesOverride } });
}
