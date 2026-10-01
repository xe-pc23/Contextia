import { ContextInputSchema, type ContextInput } from '@contextia/contracts';
import type { CalendarSource, ClockSource, ContextCollectionResult, LocationSource, NativeReadStatus } from './types';

function calendarEvents(result: Awaited<ReturnType<CalendarSource['readUpcomingEvents']>>) {
  return result.status === 'granted' ? result.events : [];
}

function calendarStatus(result: Awaited<ReturnType<CalendarSource['readUpcomingEvents']>>): NativeReadStatus {
  return result.status;
}

export class ContextCollector {
  constructor(
    private readonly locationSource: LocationSource,
    private readonly calendarSource: CalendarSource,
    private readonly clock: ClockSource
  ) {}

  async collect(): Promise<ContextCollectionResult> {
    const now = this.clock.now();
    if (!Number.isFinite(now.getTime())) {
      return { status: 'location-unavailable', location: 'unavailable', calendar: 'unavailable' };
    }

    const [locationResult, calendarResult] = await Promise.all([
      this.locationSource.readCurrentLocation().catch(() => ({ status: 'unavailable' as const })),
      this.calendarSource.readUpcomingEvents(now).catch(() => ({ status: 'unavailable' as const }))
    ]);
    const calendar = calendarStatus(calendarResult);

    if (locationResult.status !== 'granted') {
      return { status: 'location-unavailable', location: locationResult.status, calendar };
    }

    const candidate: ContextInput = {
      mode: 'real',
      deliveryMode: 'proactive',
      capturedAt: now.toISOString(),
      location: locationResult.location,
      calendar: calendarEvents(calendarResult)
    };
    const parsed = ContextInputSchema.safeParse(candidate);
    if (!parsed.success) return { status: 'invalid-context', location: 'granted', calendar };

    return {
      status: 'ready',
      input: parsed.data,
      permissions: { location: 'granted', calendar }
    };
  }
}

export class SystemClock implements ClockSource {
  now(): Date {
    return new Date();
  }
}
