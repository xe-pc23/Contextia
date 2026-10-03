import { ActivityContextSchema, RealContextInputSchema } from '@contextia/contracts';
import type { ActivityContext } from '@contextia/contracts';
import type { CalendarSource, ClockSource, ContextCollectionResult, LocationSource, NativeReadStatus, StepSource } from './types';
import { UnavailableStepSource } from './unavailableStepSource';

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
    private readonly clock: ClockSource,
    private readonly stepSource: StepSource = new UnavailableStepSource()
  ) {}

  async collect(stepGoal?: number, timezone?: string): Promise<ContextCollectionResult> {
    const now = this.clock.now();
    if (!Number.isFinite(now.getTime())) {
      return { status: 'location-unavailable', location: 'unavailable', calendar: 'unavailable', steps: 'unavailable' };
    }

    const [locationResult, calendarResult, stepResult] = await Promise.all([
      this.locationSource.readCurrentLocation().catch(() => ({ status: 'unavailable' as const })),
      this.calendarSource.readUpcomingEvents(now).catch(() => ({ status: 'unavailable' as const })),
      this.stepSource.getTodaySteps(now, timezone).catch(() => ({ status: 'unavailable' as const }))
    ]);
    const calendar = calendarStatus(calendarResult);

    let steps: NativeReadStatus = stepResult.status;
    let activity: ActivityContext = { stepsToday: null, ...(stepGoal === undefined ? {} : { stepGoal }) };
    if (stepResult.status === 'granted') {
      const measured = ActivityContextSchema.safeParse({
        stepsToday: stepResult.steps,
        stepSource: stepResult.source,
        confidence: stepResult.confidence,
        ...(stepGoal === undefined ? {} : { stepGoal, stepGoalReached: stepResult.steps >= stepGoal })
      });
      if (measured.success && measured.data.stepSource !== 'scenario') activity = measured.data;
      else steps = 'unavailable';
    }

    if (locationResult.status !== 'granted') {
      return { status: 'location-unavailable', location: locationResult.status, calendar, steps };
    }

    const candidate = {
      mode: 'real',
      deliveryMode: 'proactive',
      capturedAt: now.toISOString(),
      location: locationResult.location,
      activity,
      calendar: calendarEvents(calendarResult), calendarStatus: calendar
    };
    const parsed = RealContextInputSchema.safeParse(candidate);
    if (!parsed.success) return { status: 'invalid-context', location: 'granted', calendar, steps };

    return {
      status: 'ready',
      input: parsed.data,
      permissions: { location: 'granted', calendar, steps }
    };
  }
}

export class SystemClock implements ClockSource {
  now(): Date {
    return new Date();
  }
}
