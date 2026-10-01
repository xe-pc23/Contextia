import { describe, expect, it } from 'vitest';
import { addMinutesToWallTime, formatInstantInZone, isoToZonedWallTime, zonedWallTimeToIso } from '../src/scenario/time.js';

describe('zoned wall time conversion', () => {
  it('adds the timezone offset to a datetime-local value', () => {
    expect(zonedWallTimeToIso('2026-10-01T14:10', 'Asia/Tokyo')).toBe('2026-10-01T14:10:00+09:00');
    expect(zonedWallTimeToIso('2026-10-01T14:10:30', 'UTC')).toBe('2026-10-01T14:10:30+00:00');
    expect(zonedWallTimeToIso('2026-01-15T09:00', 'Asia/Kolkata')).toBe('2026-01-15T09:00:00+05:30');
    expect(zonedWallTimeToIso('2026-01-15T09:00', 'America/St_Johns')).toBe('2026-01-15T09:00:00-03:30');
  });

  it('uses the offset in effect on the date across DST', () => {
    expect(zonedWallTimeToIso('2026-01-15T12:00', 'America/New_York')).toBe('2026-01-15T12:00:00-05:00');
    expect(zonedWallTimeToIso('2026-07-15T12:00', 'America/New_York')).toBe('2026-07-15T12:00:00-04:00');
  });

  it('moves a skipped spring-forward time later and picks the earlier repeated time', () => {
    expect(zonedWallTimeToIso('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T03:30:00-04:00');
    expect(zonedWallTimeToIso('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T01:30:00-04:00');
  });

  it('rejects malformed values, impossible dates and unknown timezones', () => {
    expect(zonedWallTimeToIso('', 'Asia/Tokyo')).toBeNull();
    expect(zonedWallTimeToIso('2026-10-01 14:10', 'Asia/Tokyo')).toBeNull();
    expect(zonedWallTimeToIso('2026-02-30T10:00', 'Asia/Tokyo')).toBeNull();
    expect(zonedWallTimeToIso('2026-10-01T24:00', 'Asia/Tokyo')).toBeNull();
    expect(zonedWallTimeToIso('2026-10-01T14:10', 'Mars/Olympus')).toBeNull();
  });

  it('projects an instant into the timezone as a datetime-local value', () => {
    expect(isoToZonedWallTime('2026-10-01T14:10:00+09:00', 'Asia/Tokyo')).toBe('2026-10-01T14:10');
    expect(isoToZonedWallTime('2026-10-01T05:10:00Z', 'Asia/Tokyo')).toBe('2026-10-01T14:10');
    expect(isoToZonedWallTime('2026-10-01T14:10:00+09:00', 'UTC')).toBe('2026-10-01T05:10');
    expect(isoToZonedWallTime('2026-10-01T14:10:05+09:00', 'Asia/Tokyo')).toBe('2026-10-01T14:10:05');
    expect(isoToZonedWallTime('not-a-date', 'Asia/Tokyo')).toBeNull();
  });

  it('round-trips wall time and instant', () => {
    const iso = zonedWallTimeToIso('2026-12-31T23:59', 'Europe/London');
    expect(iso).toBe('2026-12-31T23:59:00+00:00');
    expect(isoToZonedWallTime(iso ?? '', 'Europe/London')).toBe('2026-12-31T23:59');
    expect(formatInstantInZone(Date.parse('2026-10-01T05:10:00Z'), 'Asia/Tokyo')).toBe('2026-10-01T14:10:00+09:00');
  });

  it('adds minutes across midnight as wall-clock arithmetic', () => {
    expect(addMinutesToWallTime('2026-10-01T23:30', 60)).toBe('2026-10-02T00:30');
    expect(addMinutesToWallTime('bad', 60)).toBeNull();
  });
});
