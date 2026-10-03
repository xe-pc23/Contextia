import type { StepReadResult, StepSource } from './types';

/** Native step adapters belong to Phase 3; unknown is never reported as zero. */
export class UnavailableStepSource implements StepSource {
  async getTodaySteps(): Promise<StepReadResult> {
    return { status: 'unavailable' };
  }
}
