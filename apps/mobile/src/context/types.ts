import type { CalendarEventContext, ContextInput, LocationContext } from '@contextia/contracts';

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

export type ContextCollectionResult =
  | {
      status: 'ready';
      input: ContextInput;
      permissions: { location: 'granted'; calendar: NativeReadStatus };
    }
  | {
      status: 'location-unavailable';
      location: 'denied' | 'unavailable';
      calendar: NativeReadStatus;
    }
  | {
      status: 'invalid-context';
      location: 'granted';
      calendar: NativeReadStatus;
    };
