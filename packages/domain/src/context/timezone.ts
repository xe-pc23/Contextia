import { TimezoneSchema } from '@contextia/contracts';

export function resolveTimezone(profileTimezone?: unknown, clientTimezone?: unknown): string {
  for (const timezone of [profileTimezone, clientTimezone]) {
    const parsed = TimezoneSchema.safeParse(timezone);
    if (parsed.success) return parsed.data;
  }
  return 'UTC';
}

// The runtime's ICU/IANA timezone database handles DST; never apply a fixed UTC offset.
export function localDate(instant: Date, timezone: string): string {
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Invalid date instant');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find(value => value.type === type)?.value;
    if (!value) throw new RangeError('Unable to resolve local calendar date');
    return value;
  };
  return `${part('year')}-${part('month')}-${part('day')}`;
}
