import { createHash } from 'node:crypto';
import type { ContextInput } from '@contextia/contracts';

const TIME_BUCKET_MS = 5 * 60 * 1000;
const STEP_BUCKET = 500;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Opaque, non-reversible ID so persisted snapshots never carry raw device calendar IDs. */
export function hashCalendarId(id: string): string {
  return sha256(`calendar:${id}`).slice(0, 32);
}

/**
 * Coarse context identity for duplicate-context guards: rounded location, 5-minute time bucket,
 * step bucket, next event key and mode. The result contains no raw PII.
 */
export function contextFingerprint(context: ContextInput): string {
  const at = Date.parse(context.mode === 'simulation' ? context.scenarioTime ?? context.capturedAt : context.capturedAt);
  const nextEvent = context.calendar
    .filter(event => !event.allDay && Date.parse(event.endAt) >= at)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  const steps = context.activity?.stepsToday;
  return sha256([
    context.mode,
    context.location.latitude.toFixed(3),
    context.location.longitude.toFixed(3),
    String(Math.floor(at / TIME_BUCKET_MS)),
    steps === undefined || steps === null ? 'none' : String(Math.floor(steps / STEP_BUCKET)),
    nextEvent ? `${hashCalendarId(nextEvent.id)}@${Date.parse(nextEvent.startAt)}` : 'none'
  ].join('|'));
}
