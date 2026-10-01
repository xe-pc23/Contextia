import { CalendarEventContextSchema, type CalendarEventContext } from '@contextia/contracts';
import { z } from 'zod';
import type { CalendarReadWindow } from './calendarWindow';

const NativeDateSchema = z.union([z.date(), z.string(), z.number().finite()]);

// Expo calendar events contain more fields (including notes, attendees, and URLs).
// Zod strips those fields, and this module only projects the minimum API contract.
const NativeEventSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  startDate: NativeDateSchema,
  endDate: NativeDateSchema,
  location: z.string().nullable().optional(),
  allDay: z.boolean().optional()
});

export type CalendarEventIdHasher = (nativeEventId: string) => Promise<string>;

function toEpochMilliseconds(value: Date | string | number): number | null {
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

/** Projects native event objects to the strict, privacy-minimized API event shape. */
export async function projectCalendarEvents(
  nativeEvents: readonly unknown[],
  window: CalendarReadWindow,
  hashEventId: CalendarEventIdHasher
): Promise<CalendarEventContext[]> {
  const startInclusive = window.startInclusive.getTime();
  const endExclusive = window.endExclusive.getTime();
  const projected = await Promise.all(nativeEvents.map(async (nativeEvent): Promise<CalendarEventContext | null> => {
    const parsed = NativeEventSchema.safeParse(nativeEvent);
    if (!parsed.success) return null;

    const start = toEpochMilliseconds(parsed.data.startDate);
    const end = toEpochMilliseconds(parsed.data.endDate);
    const title = parsed.data.title.trim().slice(0, 200);
    if (start === null || end === null || end < start || !title) return null;
    if (start >= endExclusive || end <= startInclusive) return null;

    const id = await hashEventId(parsed.data.id);
    const locationValue = parsed.data.location?.trim().slice(0, 200);
    const location = locationValue ? locationValue : null;
    const candidate = {
      id,
      title,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      location,
      ...(parsed.data.allDay === undefined ? {} : { allDay: parsed.data.allDay })
    };
    const safeEvent = CalendarEventContextSchema.safeParse(candidate);
    return safeEvent.success ? safeEvent.data : null;
  }));

  return projected
    .filter((event): event is CalendarEventContext => event !== null)
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))
    .slice(0, 100);
}
