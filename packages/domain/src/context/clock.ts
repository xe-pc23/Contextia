export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function clockInstant(clock: Clock): Date {
  const instant = clock.now();
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Clock returned an invalid instant');
  return instant;
}
