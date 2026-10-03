import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoFault, ScenarioContextInput } from '@contextia/contracts';
import { settleRun } from './runState.js';
import type { RunState } from './runState.js';
import type { ScenarioEvaluator } from './scenarioApiClient.js';

/** Runs one evaluation at a time; a stale or unmounted run never overwrites newer state. */
export function useScenarioRun(evaluator: ScenarioEvaluator | null): { state: RunState; run: (request: ScenarioContextInput, demoFault?: DemoFault) => Promise<void> } {
  const [state, setState] = useState<RunState>({ status: 'idle' });
  const latestRun = useRef(0);
  useEffect(() => () => {
    latestRun.current += 1;
  }, []);

  const run = useCallback(async (request: ScenarioContextInput, demoFault?: DemoFault) => {
    if (!evaluator) return;
    latestRun.current += 1;
    const runId = latestRun.current;
    setState({ status: 'running', request, ...(demoFault ? { demoFault } : {}) });
    const startedAt = performance.now();
    const outcome = await evaluator.evaluate(request, demoFault);
    if (runId === latestRun.current) setState(settleRun(request, outcome, Math.round(performance.now() - startedAt), demoFault));
  }, [evaluator]);

  return { state, run };
}
