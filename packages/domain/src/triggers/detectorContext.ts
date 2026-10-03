import { TimestampSchema } from '@contextia/contracts';
import type {
  ActivityContext, CalendarEventContext, CandidateOpportunity, ContextInput,
  LocationContext, TriggerType, UserPreferences
} from '@contextia/contracts';
import { clockInstant } from '../context/clock.js';
import type { Clock } from '../context/clock.js';
import { localDate, resolveTimezone } from '../context/timezone.js';

export interface DetectorContext {
  readonly mode: ContextInput['mode'];
  readonly location: LocationContext;
  readonly activity?: ActivityContext;
  readonly calendar: readonly CalendarEventContext[];
  readonly calendarStatus?: ContextInput['calendarStatus'];
  readonly preferences: UserPreferences;
  readonly stepGoal: number;
  readonly evaluationAt: Date;
  readonly timezone: string;
}

export interface NormalizeDetectorContextInput {
  readonly context: ContextInput;
  // Application-normalized preferences, including authorized scenario overrides.
  readonly preferences: UserPreferences;
  // Evaluation time for real context. Delivery guards receive their own server clock.
  readonly clock: Clock;
  readonly profileTimezone?: unknown;
  readonly clientTimezone?: unknown;
}

export interface TriggerDetector {
  readonly type: TriggerType;
  detect(input: DetectorContext): Promise<CandidateOpportunity[]>;
}

/** A daily count captured before local midnight is no evidence for the next day's goal. */
export function contextWithCurrentDayActivity(context: ContextInput, evaluationAt: Date, timezone: string): ContextInput {
  if (context.mode === 'simulation' || !context.activity || localDate(new Date(TimestampSchema.parse(context.capturedAt)), timezone) === localDate(evaluationAt, timezone)) return context;
  const current = { ...context };
  delete current.activity;
  return current;
}

export function normalizeDetectorContext(input: NormalizeDetectorContextInput): DetectorContext {
  const evaluationAt = input.context.mode === 'simulation'
    ? new Date(TimestampSchema.parse(input.context.scenarioTime ?? input.context.capturedAt))
    : clockInstant(input.clock);
  const timezone = resolveTimezone(input.profileTimezone, input.clientTimezone);
  const context = contextWithCurrentDayActivity(input.context, evaluationAt, timezone);
  return {
    mode: context.mode,
    location: context.location,
    ...(context.activity ? { activity: context.activity } : {}),
    calendar: context.calendarStatus === undefined || context.calendarStatus === 'granted' ? context.calendar : [],
    calendarStatus: context.calendarStatus ?? 'granted',
    preferences: input.preferences,
    stepGoal: context.activity?.stepGoal ?? input.preferences.stepGoal,
    evaluationAt,
    timezone
  };
}
