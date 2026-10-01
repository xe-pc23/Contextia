import type { ScenarioId } from '@contextia/contracts';

// Presets fill the editor through getScenarioInput; they never supply results.
// Phase 1 exposes the step-goal slice only.
export const DEFAULT_PRESET_ID: ScenarioId = 'step-goal';
export const CONSOLE_PRESETS: readonly { readonly id: ScenarioId; readonly label: string }[] = [
  { id: 'step-goal', label: '歩数目標達成' }
];
