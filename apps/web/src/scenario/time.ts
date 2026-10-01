// Converts between datetime-local wall times and RFC 3339 instants for one IANA
// timezone. Ambiguous and skipped local times follow Temporal's "compatible"
// rule: a repeated time uses the earlier instant, a skipped time moves forward.

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    formatters.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

function wallPartsAt(epochMs: number, formatter: Intl.DateTimeFormat): WallParts {
  const parts = formatter.formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
}

function wallAsUtc(parts: WallParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function offsetMinutesAt(epochMs: number, formatter: Intl.DateTimeFormat): number {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000;
  return Math.round((wallAsUtc(wallPartsAt(wholeSecond, formatter)) - wholeSecond) / MINUTE_MS);
}

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, '0');
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  return `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

function parseWallTime(wall: string): WallParts | null {
  const match = WALL_TIME.exec(wall);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(value => (value === undefined ? 0 : Number(value)));
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined) return null;
  const parts = { year, month, day, hour, minute, second };
  const check = new Date(wallAsUtc(parts));
  const sameDate = check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
  return sameDate && hour <= 23 && minute <= 59 && second <= 59 ? parts : null;
}

/** Formats an instant in the timezone as `YYYY-MM-DDTHH:mm:ss±HH:MM`. */
export function formatInstantInZone(epochMs: number, timeZone: string): string | null {
  const formatter = formatterFor(timeZone);
  if (!formatter || !Number.isFinite(epochMs)) return null;
  const wall = wallPartsAt(epochMs, formatter);
  const date = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
  return `${date}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}${formatOffset(offsetMinutesAt(epochMs, formatter))}`;
}

/** Converts a datetime-local value to an RFC 3339 timestamp with the zone's offset. */
export function zonedWallTimeToIso(wall: string, timeZone: string): string | null {
  const formatter = formatterFor(timeZone);
  const parts = parseWallTime(wall);
  if (!formatter || !parts) return null;
  const localAsUtc = wallAsUtc(parts);
  const offsetBefore = offsetMinutesAt(localAsUtc - DAY_MS, formatter);
  const offsetAfter = offsetMinutesAt(localAsUtc + DAY_MS, formatter);
  const matching = [offsetBefore, offsetAfter]
    .map(offset => localAsUtc - offset * MINUTE_MS)
    .filter(candidate => wallAsUtc(wallPartsAt(candidate, formatter)) === localAsUtc);
  // No match means the wall time was skipped; the pre-transition offset lands after the gap.
  const instant = matching.length > 0 ? Math.min(...matching) : localAsUtc - offsetBefore * MINUTE_MS;
  return formatInstantInZone(instant, timeZone);
}

/** Converts an RFC 3339 timestamp to a datetime-local value in the timezone. */
export function isoToZonedWallTime(iso: string, timeZone: string): string | null {
  const formatter = formatterFor(timeZone);
  const epochMs = Date.parse(iso);
  if (!formatter || !Number.isFinite(epochMs)) return null;
  const wall = wallPartsAt(epochMs, formatter);
  const minutes = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
  return wall.second === 0 ? minutes : `${minutes}:${pad(wall.second)}`;
}

/** Adds minutes to a datetime-local value as plain wall-clock arithmetic. */
export function addMinutesToWallTime(wall: string, minutes: number): string | null {
  const parts = parseWallTime(wall);
  if (!parts) return null;
  const shifted = new Date(wallAsUtc(parts) + minutes * MINUTE_MS);
  const date = `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return `${date}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}
