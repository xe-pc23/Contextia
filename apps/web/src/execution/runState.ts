import type { EvaluationResult, ScenarioContextInput } from '@contextia/contracts';
import type { EvaluateFailure, EvaluateOutcome } from './scenarioApiClient.js';

export type RunState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly request: ScenarioContextInput }
  | {
    readonly status: 'succeeded'; readonly request: ScenarioContextInput; readonly requestId: string;
    readonly result: EvaluationResult; readonly elapsedMs: number;
  }
  | { readonly status: 'failed'; readonly request: ScenarioContextInput; readonly failure: EvaluateFailure; readonly elapsedMs: number };

export function settleRun(request: ScenarioContextInput, outcome: EvaluateOutcome, elapsedMs: number): RunState {
  return outcome.kind === 'success'
    ? { status: 'succeeded', request, requestId: outcome.requestId, result: outcome.result, elapsedMs }
    : { status: 'failed', request, failure: outcome, elapsedMs };
}
