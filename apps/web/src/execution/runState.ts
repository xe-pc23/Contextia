import type { DemoFault, EvaluationResult, ScenarioContextInput } from '@contextia/contracts';
import type { EvaluateFailure, EvaluateOutcome } from './scenarioApiClient.js';

export type RunState = (
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly request: ScenarioContextInput }
  | {
    readonly status: 'succeeded'; readonly request: ScenarioContextInput; readonly requestId: string;
    readonly result: EvaluationResult; readonly elapsedMs: number;
  }
  | { readonly status: 'failed'; readonly request: ScenarioContextInput; readonly failure: EvaluateFailure; readonly elapsedMs: number }
) & { readonly demoFault?: DemoFault };

export function settleRun(request: ScenarioContextInput, outcome: EvaluateOutcome, elapsedMs: number, demoFault?: DemoFault): RunState {
  const diagnostic = demoFault ? { demoFault } : {};
  return outcome.kind === 'success'
    ? { status: 'succeeded', request, requestId: outcome.requestId, result: outcome.result, elapsedMs, ...diagnostic }
    : { status: 'failed', request, failure: outcome, elapsedMs, ...diagnostic };
}
