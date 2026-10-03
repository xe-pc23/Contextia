import { ApiFailure } from './apiFailure.js';

/** One monotonic budget shared by reads, enrichment, model and persistence. */
export class EvaluationDeadline {
  private readonly expiresAt: number;

  constructor(timeoutMs: number) {
    this.expiresAt = performance.now() + timeoutMs;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const remaining = this.expiresAt - performance.now();
    if (remaining <= 0) throw new ApiFailure('EVALUATION_TIMEOUT');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (performance.now() >= this.expiresAt) throw new ApiFailure('EVALUATION_TIMEOUT');
          return operation();
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ApiFailure('EVALUATION_TIMEOUT')), remaining);
        })
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
