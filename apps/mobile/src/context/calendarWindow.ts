export type CalendarReadWindow = {
  startInclusive: Date;
  endExclusive: Date;
};

/** Start at today's local midnight and end at local midnight after the next three days. */
export function getCalendarReadWindow(now: Date): CalendarReadWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Calendar window requires a valid date');

  return {
    startInclusive: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    endExclusive: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4)
  };
}
