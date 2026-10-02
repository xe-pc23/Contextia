import type { CalendarEventContext, DetectorPolicy, GeoPoint } from '@contextia/contracts';
import type { DetectorContext } from './detectorContext.js';

export const MINUTE_MS = 60_000;

export function evaluationMillis(input: DetectorContext): number {
  const now = input.evaluationAt.getTime();
  if (!Number.isFinite(now)) throw new RangeError('Invalid detector evaluation time');
  return now;
}

export interface CalendarWindow {
  readonly busy: boolean;
  readonly timedBusy: boolean;
  readonly nextEvent: CalendarEventContext | undefined;
  readonly nextTimedEvent: CalendarEventContext | undefined;
  readonly previousEventId: string | undefined;
  readonly ambiguousIds: ReadonlySet<string>;
}

// All-day intervals conservatively occupy free-time gaps; timed detours use timedBusy and a timed destination.
export function calendarWindow(input: DetectorContext): CalendarWindow {
  const now = evaluationMillis(input);
  const events = [...input.calendar].sort((a, b) =>
    Date.parse(a.startAt) - Date.parse(b.startAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Map<string, string>();
  const ambiguousIds = new Set<string>();
  for (const event of events) {
    const signature = JSON.stringify([Date.parse(event.startAt), Date.parse(event.endAt), event.location?.trim() || null, event.allDay ?? false]);
    const previous = seen.get(event.id);
    if (previous !== undefined && previous !== signature) ambiguousIds.add(event.id);
    seen.set(event.id, signature);
  }
  const future = events.filter(event => Date.parse(event.startAt) > now);
  const past = events.filter(event => Date.parse(event.endAt) <= now)
    .sort((a, b) => Date.parse(b.endAt) - Date.parse(a.endAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    busy: events.some(event => Date.parse(event.startAt) <= now && now < Date.parse(event.endAt)),
    timedBusy: events.some(event => !event.allDay && Date.parse(event.startAt) <= now && now < Date.parse(event.endAt)),
    nextEvent: future[0],
    nextTimedEvent: future.find(event => !event.allDay),
    previousEventId: past[0]?.id,
    ambiguousIds
  };
}

// The activity horizon is a local recommendation bound, not an earlier arrival deadline for a distant event.
export function activityDeadlines(
  input: DetectorContext, policy: Readonly<DetectorPolicy>, event: CalendarEventContext | undefined, early = false
): { activityDeadlineAt: number; returnDeadlineAt: number } {
  const horizon = evaluationMillis(input) + policy.maximumFreeTimeMinutes * MINUTE_MS;
  const returnDeadlineAt = event ? Date.parse(event.startAt) - policy.arrivalBufferMinutes * MINUTE_MS : horizon;
  return { activityDeadlineAt: early ? returnDeadlineAt : Math.min(horizon, returnDeadlineAt), returnDeadlineAt };
}

export function hasEventLocation(event: CalendarEventContext): boolean {
  return Boolean(event.location?.trim());
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const radians = Math.PI / 180;
  const latitudeDifference = (b.latitude - a.latitude) * radians;
  const longitudeDifference = (b.longitude - a.longitude) * radians;
  const haversine = Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(longitudeDifference / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}
