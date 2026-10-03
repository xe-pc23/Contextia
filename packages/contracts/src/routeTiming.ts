import { TimestampSchema } from './context.js';

const NANOS_PER_MILLISECOND = 1_000_000n;

/** Provider timestamps retain nanosecond ordering; application budgets use conservative milliseconds. */
export function timestampNanoseconds(value: string): bigint {
  TimestampSchema.parse(value);
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '';
  const submillisecond = BigInt(fraction.slice(0, 9).padEnd(9, '0')) % NANOS_PER_MILLISECOND;
  return BigInt(Date.parse(value)) * NANOS_PER_MILLISECOND + submillisecond;
}

export function ceilNanosecondsToMilliseconds(value: bigint): number {
  return Number(value / NANOS_PER_MILLISECOND + (value % NANOS_PER_MILLISECOND > 0n ? 1n : 0n));
}

export function scheduledDurationMilliseconds(departAt: string, arriveAt: string): number | null {
  const elapsed = timestampNanoseconds(arriveAt) - timestampNanoseconds(departAt);
  return elapsed < 0n ? null : ceilNanosecondsToMilliseconds(elapsed);
}
