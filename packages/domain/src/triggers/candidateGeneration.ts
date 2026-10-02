import { CandidateOpportunitySchema } from '@contextia/contracts';
import type { CandidateOpportunity, DetectorPolicy } from '@contextia/contracts';
import { localDate } from '../context/timezone.js';
import { activityDeadlines, calendarWindow, evaluationMillis, hasEventLocation, MINUTE_MS } from './calendar.js';
import type { DetectorContext } from './detectorContext.js';

export function generateUpcomingEventTransitCandidates(input: DetectorContext, policy: Readonly<DetectorPolicy>): CandidateOpportunity[] {
  const window = calendarWindow(input);
  const event = window.nextTimedEvent;
  if (!event || !hasEventLocation(event) || window.ambiguousIds.has(event.id)) return [];
  const minutesUntilEvent = (Date.parse(event.startAt) - evaluationMillis(input)) / MINUTE_MS;
  if (minutesUntilEvent > policy.upcomingEventHorizonMinutes) return [];
  return [CandidateOpportunitySchema.parse({
    type: 'UPCOMING_EVENT_TRANSIT', confidence: 1, anchorKey: event.id,
    requiredSignals: ['time', 'location', 'calendar', 'transit'],
    providerNeeds: ['geocode-event-location', 'route-to-next-event'],
    facts: {
      eventId: event.id, eventStartAt: event.startAt, minutesUntilEvent,
      routeArriveBy: new Date(Date.parse(event.startAt) - policy.arrivalBufferMinutes * MINUTE_MS).toISOString()
    }
  })];
}

export function generateFreeTimeNearbyCandidates(input: DetectorContext, policy: Readonly<DetectorPolicy>): CandidateOpportunity[] {
  const window = calendarWindow(input);
  if (window.busy || (window.nextEvent && window.ambiguousIds.has(window.nextEvent.id))) return [];
  const now = evaluationMillis(input);
  const end = Math.min(now + policy.maximumFreeTimeMinutes * MINUTE_MS,
    window.nextEvent ? Date.parse(window.nextEvent.startAt) : Number.POSITIVE_INFINITY);
  const availableMinutes = (end - now) / MINUTE_MS;
  if (availableMinutes < policy.minimumGapMinutes) return [];
  const deadlines = activityDeadlines(input, policy, window.nextEvent);
  const day = localDate(input.evaluationAt, input.timezone);
  // Request optional weather/routing to improve assessment; missing results do not erase the gap.
  const providerNeeds: CandidateOpportunity['providerNeeds'] = ['places-near-current', 'weather-current', 'route-to-place-candidates'];
  if (window.nextEvent && hasEventLocation(window.nextEvent)) providerNeeds.push('geocode-event-location');
  return [CandidateOpportunitySchema.parse({
    type: 'FREE_TIME_NEARBY', confidence: 0.75,
    anchorKey: `gap:${JSON.stringify([window.previousEventId ?? null, window.nextEvent?.id ?? null, window.previousEventId === undefined ? day : null])}`,
    requiredSignals: ['time', 'location', 'calendar', 'places', 'preferences'],
    providerNeeds,
    facts: {
      availableMinutes, gapEndsAt: new Date(end).toISOString(), nextEventId: window.nextEvent?.id ?? null,
      activityDeadlineAt: new Date(deadlines.activityDeadlineAt).toISOString(),
      returnDeadlineAt: new Date(deadlines.returnDeadlineAt).toISOString()
    }
  })];
}

export function generateWeatherAdaptationCandidates(input: DetectorContext): CandidateOpportunity[] {
  const event = calendarWindow(input).nextTimedEvent;
  return [CandidateOpportunitySchema.parse({
    type: 'WEATHER_ADAPTATION', confidence: 0.75,
    anchorKey: `weather:${JSON.stringify([localDate(input.evaluationAt, input.timezone), event?.id ?? null])}`,
    requiredSignals: ['time', 'location', 'weather'],
    providerNeeds: ['weather-today', 'places-near-current'],
    facts: { evaluationAt: input.evaluationAt.toISOString(), nextEventId: event?.id ?? null }
  })];
}

export function generateEarlyArrivalDetourCandidates(input: DetectorContext, policy: Readonly<DetectorPolicy>): CandidateOpportunity[] {
  const window = calendarWindow(input);
  const event = window.nextTimedEvent;
  if (window.timedBusy || !event || !hasEventLocation(event) || window.ambiguousIds.has(event.id)) return [];
  const availableMinutes = (Date.parse(event.startAt) - evaluationMillis(input)) / MINUTE_MS;
  if (availableMinutes < policy.minimumEarlyArrivalMinutes || availableMinutes > policy.upcomingEventHorizonMinutes) return [];
  return [CandidateOpportunitySchema.parse({
    type: 'EARLY_ARRIVAL_DETOUR', confidence: 0.75, anchorKey: event.id,
    requiredSignals: ['time', 'location', 'calendar', 'places'],
    providerNeeds: ['geocode-event-location', 'places-near-destination', 'route-to-place-candidates'],
    facts: { eventId: event.id, eventStartAt: event.startAt, availableMinutes }
  })];
}
