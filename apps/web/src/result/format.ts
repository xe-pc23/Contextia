function formatIn(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  const epochMs = Date.parse(iso);
  if (!Number.isFinite(epochMs)) return iso;
  try {
    return new Intl.DateTimeFormat('ja-JP', { timeZone, hourCycle: 'h23', ...options }).format(epochMs);
  } catch {
    return iso;
  }
}

/** `HH:mm` in the scenario timezone. */
export function formatClock(iso: string, timeZone: string): string {
  return formatIn(iso, timeZone, { hour: '2-digit', minute: '2-digit' });
}

/** Month, day and time in the scenario timezone. */
export function formatDateTime(iso: string, timeZone: string): string {
  return formatIn(iso, timeZone, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `約${Math.round(meters)} m` : `約${(meters / 1000).toFixed(1)} km`;
}
