import type { ActivityContext, CalendarEventContext, ContextInput, LocationContext } from '@contextia/contracts';

export type NativeReadStatus = 'granted' | 'denied' | 'unavailable';

export type LocationReadResult =
  | { status: 'granted'; location: LocationContext }
  | { status: 'denied' }
  | { status: 'unavailable' };

export type CalendarReadResult =
  | { status: 'granted'; events: CalendarEventContext[] }
  | { status: 'denied' }
  | { status: 'unavailable' };

export interface LocationSource {
  readCurrentLocation(): Promise<LocationReadResult>;
}

export interface CalendarSource {
  readUpcomingEvents(now: Date): Promise<CalendarReadResult>;
}

export interface ClockSource {
  now(): Date;
}

export type StepReadResult =
  | {
      status: 'granted';
      steps: number;
      source: Exclude<NonNullable<ActivityContext['stepSource']>, 'scenario'>;
      confidence: NonNullable<ActivityContext['confidence']>;
    }
  | { status: 'denied' | 'unavailable' };

export interface StepSource {
  getTodaySteps(now: Date): Promise<StepReadResult>;
}

export type RealContextInput = Extract<ContextInput, { mode: 'real' }>;

export type ContextCollectionResult =
  | {
      status: 'ready';
      input: RealContextInput;
      permissions: { location: 'granted'; calendar: NativeReadStatus; steps: NativeReadStatus };
    }
  | {
      status: 'location-unavailable';
      location: 'denied' | 'unavailable';
      calendar: NativeReadStatus;
      steps: NativeReadStatus;
    }
  | {
      status: 'invalid-context';
      location: 'granted';
      calendar: NativeReadStatus;
      steps: NativeReadStatus;
    };
