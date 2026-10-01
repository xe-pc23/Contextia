import { TimestampSchema } from '@contextia/contracts';
import type {
  ActivityContext, CalendarEventContext, CandidateOpportunity, ContextInput,
  LocationContext, TriggerType, UserPreferences
} from '@contextia/contracts';
import { clockInstant } from '../context/clock.js';
import type { Clock } from '../context/clock.js';
import { resolveTimezone } from '../context/timezone.js';

export interface DetectorContext {
  readonly mode: ContextInput['mode'];
  readonly location: LocationContext;
  readonly activity?: ActivityContext;
  readonly calendar: readonly CalendarEventContext[];
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

export function normalizeDetectorContext(input: NormalizeDetectorContextInput): DetectorContext {
  const context = input.context;
  const evaluationAt = context.mode === 'simulation'
    ? new Date(TimestampSchema.parse(context.scenarioTime ?? context.capturedAt))
    : clockInstant(input.clock);
  return {
    mode: context.mode,
    location: context.location,
    ...(context.activity ? { activity: context.activity } : {}),
    calendar: context.calendar,
    preferences: input.preferences,
    stepGoal: context.activity?.stepGoal ?? input.preferences.stepGoal,
    evaluationAt,
    timezone: resolveTimezone(input.profileTimezone, input.clientTimezone)
  };
}
