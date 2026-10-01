export type CalendarReadWindow = {
  startInclusive: Date;
  endExclusive: Date;
};

const MAX_EVENT_DURATION_MS = 31 * 24 * 60 * 60 * 1000;

/** Start at today's local midnight and end at local midnight after the next three days. */
export function getCalendarReadWindow(now: Date): CalendarReadWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Calendar window requires a valid date');

  return {
    startInclusive: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    endExclusive: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4)
  };
}

/**
 * Some calendar providers return only events fully contained by the query.
 * Pad by the contract's maximum non-all-day duration, then project back to
 * the requested window so boundary-spanning events are included consistently.
 */
export function getCalendarQueryWindow(window: CalendarReadWindow): CalendarReadWindow {
  return {
    startInclusive: new Date(window.startInclusive.getTime() - MAX_EVENT_DURATION_MS),
    endExclusive: new Date(window.endExclusive.getTime() + MAX_EVENT_DURATION_MS)
  };
}
