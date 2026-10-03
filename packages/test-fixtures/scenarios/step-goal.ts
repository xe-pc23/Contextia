import type { ScenarioFixture } from '../src/types.js';
import { cafe, context, preferences, unrequested } from './shared.js';

const input = context('2026-10-01T14:10:00+09:00');
export const stepGoal: ScenarioFixture = {
  id: 'step-goal', label: '歩数目標達成', primaryTrigger: 'STEP_GOAL_REST', providerNeeds: ['places-near-current'],
  context: { ...input, activity: { ...input.activity, stepsToday: 10_432, stepGoalReached: true } }, preferences,
  providers: { geocoding: unrequested(), places: { status: 'ok', data: [cafe] }, weather: unrequested(), routes: unrequested() }
};

export const stepGoalBelowGoal: ScenarioFixture = {
  ...stepGoal,
  label: '歩数目標未達',
  context: { ...stepGoal.context, activity: { ...stepGoal.context.activity, stepsToday: 9_999, stepGoalReached: false } }
};

export const stepGoalStepsUnavailable: ScenarioFixture = {
  ...stepGoal,
  label: '歩数取得不可',
  context: { ...stepGoal.context, activity: { ...stepGoal.context.activity, stepsToday: null, stepGoalReached: false } }
};
