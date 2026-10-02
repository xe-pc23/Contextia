import { CandidateEvidenceSchema, CandidateOpportunitySchema, SignalNameSchema } from '@contextia/contracts';
import type {
  CandidateDiagnosticCode, CandidateEvidence, CandidateExclusionReason, CandidateOpportunity, DetectorPolicy, GeoPoint, ProviderPlace, RouteSummary, SignalName
} from '@contextia/contracts';
import { activityDeadlines, calendarWindow, distanceMeters, evaluationMillis, hasEventLocation, MINUTE_MS } from './calendar.js';
import {
  generateEarlyArrivalDetourCandidates, generateFreeTimeNearbyCandidates,
  generateUpcomingEventTransitCandidates, generateWeatherAdaptationCandidates
} from './candidateGeneration.js';
import type { DetectorContext } from './detectorContext.js';
import { detectorPolicy } from './detectorPolicy.js';
import { destinationFor, forecastWeatherBetween, journeyArrival, matchingRoutes, placesFor, weatherAt } from './evidence.js';
import type { EvidenceResult, WeatherReading } from './evidence.js';
import { generateStepGoalRestCandidates } from './stepGoalRest.js';

export interface CandidateExclusion {
  readonly type: CandidateOpportunity['type'];
  readonly anchorKey: string;
  // null: supplied facts do not justify this opportunity. Other codes are candidate diagnostics,
  // never global delivery guards and never appended to delivery.wouldSuppress.
  readonly code: CandidateDiagnosticCode | null;
  readonly reason?: CandidateExclusionReason;
}
export interface CandidateRefinementResult {
  readonly candidates: CandidateOpportunity[];
  readonly exclusions: CandidateExclusion[];
}
export interface RefineCandidatesInput {
  readonly context: DetectorContext;
  readonly candidates: readonly CandidateOpportunity[];
  readonly evidence: unknown;
  readonly policy?: Readonly<DetectorPolicy>;
  // Optional capability information from the caller. An empty calendar is otherwise valid evidence.
  readonly availableSignals?: readonly SignalName[];
}

function excluded(
  candidate: CandidateOpportunity, code: CandidateDiagnosticCode | null, reason?: CandidateExclusionReason
): CandidateExclusion {
  return { type: candidate.type, anchorKey: candidate.anchorKey, code, ...(reason ? { reason } : {}) };
}

export function filterCandidatesBySignals(
  candidates: readonly CandidateOpportunity[], availableSignals: readonly SignalName[]
): CandidateRefinementResult {
  const signals = new Set(SignalNameSchema.array().parse(availableSignals));
  const kept: CandidateOpportunity[] = [];
  const exclusions: CandidateExclusion[] = [];
  for (const candidate of CandidateOpportunitySchema.array().parse(candidates)) {
    if (candidate.requiredSignals.some(signal => !signals.has(signal))) exclusions.push(excluded(candidate, 'MISSING_REQUIRED_SIGNAL'));
    else kept.push(candidate);
  }
  return { candidates: kept, exclusions };
}

function seedFor(candidate: CandidateOpportunity, context: DetectorContext, policy: Readonly<DetectorPolicy>): CandidateOpportunity | undefined {
  const generated = (() => {
    switch (candidate.type) {
      case 'UPCOMING_EVENT_TRANSIT': return generateUpcomingEventTransitCandidates(context, policy);
      case 'STEP_GOAL_REST': return generateStepGoalRestCandidates(context);
      case 'FREE_TIME_NEARBY': return generateFreeTimeNearbyCandidates(context, policy);
      case 'WEATHER_ADAPTATION': return generateWeatherAdaptationCandidates(context);
      case 'EARLY_ARRIVAL_DETOUR': return generateEarlyArrivalDetourCandidates(context, policy);
    }
  })();
  return generated.find(value => value.anchorKey === candidate.anchorKey);
}

interface PlaceTimeBudget {
  placeId: string;
  outboundRouteId: string;
  returnRouteId: string;
  activityMinutes: number;
}

function activityBudgets(
  context: DetectorContext, places: ProviderPlace[], target: GeoPoint, deadline: number, activityDeadline: number,
  evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>
): PlaceTimeBudget[] {
  const now = evaluationMillis(context);
  const budgets: PlaceTimeBudget[] = [];
  for (const place of places) {
    const outbound = matchingRoutes(evidence, 'route-to-place-candidates', place.placeId, context.location, place, policy);
    const returning = matchingRoutes(evidence, 'route-to-place-candidates', place.placeId, place, target, policy);
    let best: PlaceTimeBudget | undefined;
    for (const route of outbound) {
      const arrival = journeyArrival(route, now);
      if (arrival === null) continue;
      for (const back of returning) {
        // Nearby endpoints may both match the tolerance. A single route cannot prove a round trip.
        if (back.routeId === route.routeId) continue;
        const returnedAt = journeyArrival(back, arrival + policy.minimumActivityMinutes * MINUTE_MS);
        if (returnedAt === null || returnedAt > deadline) continue;
        const returnDeparture = back.departAt ? Date.parse(back.departAt)
          : Math.min(deadline, back.arriveAt ? Date.parse(back.arriveAt) : deadline) - back.durationMinutes * MINUTE_MS;
        const latestDeparture = Math.min(activityDeadline, returnDeparture);
        const activityMinutes = (latestDeparture - arrival) / MINUTE_MS;
        if (activityMinutes < policy.minimumActivityMinutes) continue;
        const budget = { placeId: place.placeId, outboundRouteId: route.routeId, returnRouteId: back.routeId, activityMinutes };
        if (!best || budget.activityMinutes > best.activityMinutes) best = budget;
      }
    }
    if (best) budgets.push(best);
  }
  return budgets;
}

function hasJourneyTiming(route: RouteSummary): boolean {
  return route.mode === 'pedestrian' || Boolean(route.departAt && route.arriveAt);
}

// Optional routing must not erase the gap opportunity. Keep unresolved place discovery separate
// from verified time-fit options, and never fill a missing journey with an invented duration.
function unverifiedActivityPlaceIds(
  context: DetectorContext, places: ProviderPlace[], target: GeoPoint | undefined, deadline: number, activityDeadline: number,
  evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>
): string[] {
  const now = evaluationMillis(context);
  const activityMillis = policy.minimumActivityMinutes * MINUTE_MS;
  return places.filter(place => {
    const outward = matchingRoutes(evidence, 'route-to-place-candidates', place.placeId, context.location, place, policy)
      .filter(hasJourneyTiming);
    const returning = target ? matchingRoutes(evidence, 'route-to-place-candidates', place.placeId, place, target, policy)
      .filter(hasJourneyTiming) : [];
    // A complete pair is either verified by activityBudgets or known not to fit; neither is unknown.
    if (outward.some(route => returning.some(back => back.routeId !== route.routeId))) return false;
    const outwardCanFit = !outward.length || outward.some(route => {
      const arrival = journeyArrival(route, now);
      return arrival !== null && arrival + activityMillis <= activityDeadline;
    });
    const returnCanFit = !returning.length || returning.some(route => {
      // Even with zero outward travel, an impossible return cannot fit any activity here.
      const arrival = journeyArrival(route, now + activityMillis);
      return arrival !== null && arrival <= deadline;
    });
    return outwardCanFit && returnCanFit;
  }).map(place => place.placeId);
}

type Assessment = EvidenceResult<CandidateOpportunity | null> & { readonly reason?: CandidateExclusionReason };

function assessUpcoming(
  seed: CandidateOpportunity, context: DetectorContext, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>
): Assessment {
  const event = calendarWindow(context).nextTimedEvent;
  if (!event) return { ok: false, code: 'MISSING_REQUIRED_SIGNAL' };
  const destination = destinationFor(event.id, evidence, policy);
  if (!destination.ok) return destination;
  const now = evaluationMillis(context);
  const deadline = Date.parse(event.startAt) - policy.arrivalBufferMinutes * MINUTE_MS;
  const planned = { ...evidence, routes: evidence.routes.filter(entry =>
    entry.arriveBy !== undefined && Date.parse(entry.arriveBy) === deadline) };
  const routes = matchingRoutes(planned, 'route-to-next-event', event.id, context.location, destination.value, policy)
    .filter((route): route is RouteSummary & { departAt: string; arriveAt: string } =>
      (route.mode === 'transit' || route.mode === 'intermodal') && route.departAt !== undefined && route.arriveAt !== undefined);
  if (!routes.length) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  const journeys = routes.map(route => ({ route, departure: Date.parse(route.departAt), arrival: Date.parse(route.arriveAt) }));
  const feasible = journeys.filter(journey => journey.departure >= now && journey.arrival <= deadline)
    .sort((a, b) => b.departure - a.departure || a.arrival - b.arrival ||
      a.route.durationMinutes - b.route.durationMinutes ||
      (a.route.routeId < b.route.routeId ? -1 : a.route.routeId > b.route.routeId ? 1 : 0));
  // Missing the planned journey is a timing diagnostic, never permission to invent a replacement timetable.
  const latest = feasible[0];
  if (!latest) return { ok: true, value: null,
    reason: journeys.every(journey => journey.departure < now) ? 'DEPARTURE_PASSED' : 'ARRIVAL_BUFFER_MISSED' };
  if (latest.departure > now + policy.departureLeadMinutes * MINUTE_MS) return { ok: true, value: null };
  const { route, departure } = latest;
  return { ok: true, value: {
    ...seed, confidence: Math.min(seed.confidence, destination.value.confidence),
    facts: {
      ...seed.facts, destinationPlaceId: destination.value.placeId, routeId: route.routeId,
      routeDurationMinutes: route.durationMinutes, latestDepartureAt: new Date(departure).toISOString(),
      departureSource: 'provider', providerDepartAt: route.departAt, providerArriveAt: route.arriveAt
    }
  } };
}

function assessActivity(
  seed: CandidateOpportunity, context: DetectorContext, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>
): Assessment {
  const early = seed.type === 'EARLY_ARRIVAL_DETOUR';
  const window = calendarWindow(context);
  const event = early ? window.nextTimedEvent : window.nextEvent;
  // With a next event, only its confirmed destination can prove the onward journey.
  // A return to current position is valid only for an open-ended gap without a next event.
  let target: GeoPoint | undefined = event ? undefined : context.location;
  let destinationPlaceId: string | undefined;
  if (event && hasEventLocation(event)) {
    const destination = destinationFor(event.id, evidence, policy);
    if (!destination.ok) {
      if (early) return destination;
      // The event still constrains the gap. Its unconfirmed coordinates must not be replaced by current location.
      target = undefined;
    } else {
      target = destination.value;
      destinationPlaceId = destination.value.placeId;
    }
  }
  const distance = target ? distanceMeters(context.location, target) : null;
  if (early && (distance === null || distance + (context.location.accuracyMeters ?? 0) > policy.earlyArrivalRadiusMeters)) return { ok: true, value: null };
  const now = evaluationMillis(context);
  const { activityDeadlineAt: activityDeadline, returnDeadlineAt: deadline } = activityDeadlines(context, policy, event, early);
  if (!early && activityDeadline - now < policy.minimumActivityMinutes * MINUTE_MS) return { ok: true, value: null };
  const nearby = placesFor(evidence, early ? 'places-near-destination' : 'places-near-current', early && event ? event.id : 'current');
  if (!nearby.ok) return nearby;
  if (!nearby.value.length) return { ok: true, value: null };
  const budgets = target ? activityBudgets(context, nearby.value, target, deadline, activityDeadline, evidence, policy) : [];
  const unverifiedPlaceIds = early ? [] : unverifiedActivityPlaceIds(context, nearby.value, target, deadline, activityDeadline, evidence, policy);
  if (!budgets.length && !unverifiedPlaceIds.length) {
    if (!early) return { ok: true, value: null };
    const hasRoutes = target && nearby.value.some(place => {
      const outward = matchingRoutes(evidence, 'route-to-place-candidates', place.placeId, context.location, place, policy);
      const returning = matchingRoutes(evidence, 'route-to-place-candidates', place.placeId, place, target, policy);
      return outward.some(route => returning.some(back => back.routeId !== route.routeId));
    });
    return hasRoutes ? { ok: true, value: null } : { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  }
  return { ok: true, value: {
    ...seed,
    confidence: early && context.location.accuracyMeters === undefined ? Math.min(seed.confidence, 0.5) : seed.confidence,
    facts: {
      ...seed.facts, eligiblePlaceIds: budgets.map(budget => budget.placeId), placeTimeBudgets: budgets,
      returnDeadlineAt: new Date(deadline).toISOString(),
      ...(!early ? { unverifiedPlaceIds, minimumActivityMinutes: policy.minimumActivityMinutes,
        activityDeadlineAt: new Date(activityDeadline).toISOString() } : {}),
      ...(destinationPlaceId ? { destinationPlaceId } : {}),
      ...(early ? { destinationDistanceMeters: distance, accuracyMeters: context.location.accuracyMeters ?? null } : {})
    }
  } };
}

function weatherIssues(weather: WeatherReading, policy: Readonly<DetectorPolicy>): string[] {
  const wet = ['rain', 'snow', 'storm'].includes(weather.condition) ||
    (weather.precipitationMillimeters ?? 0) >= policy.precipitationThresholdMillimeters ||
    (weather.precipitationProbability ?? 0) >= policy.precipitationProbabilityThreshold;
  const temperature = weather.feelsLikeCelsius ?? weather.temperatureCelsius;
  const hot = temperature !== null && temperature >= policy.heatThresholdCelsius;
  return [...(wet ? ['precipitation'] : []), ...(hot ? ['heat'] : [])];
}

function assessWeather(
  seed: CandidateOpportunity, context: DetectorContext, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>,
  calendarAvailable: boolean
): Assessment {
  const now = evaluationMillis(context);
  const current = weatherAt(evidence, now, policy, context.mode);
  const window = calendarWindow(context);
  const event = window.nextTimedEvent;
  const forecasts = (!current || !weatherIssues(current, policy).length) && calendarAvailable && event &&
    !window.ambiguousIds.has(event.id) && Date.parse(event.startAt) <= now + policy.upcomingEventHorizonMinutes * MINUTE_MS
    ? forecastWeatherBetween(evidence, now, Date.parse(event.startAt)) : [];
  const worsening = forecasts.find(reading => weatherIssues(reading.weather, policy).length > 0);
  const weather = worsening?.weather ?? current ?? forecasts[0]?.weather;
  if (!weather) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  const issues = weatherIssues(weather, policy);
  if (!issues.length) return { ok: true, value: null };
  const places = placesFor(evidence, 'places-near-current', 'current');
  return { ok: true, value: {
    ...seed, requiredSignals: worsening ? [...seed.requiredSignals, 'calendar'] : seed.requiredSignals,
    facts: {
      ...seed.facts, weather, weatherIssues: issues,
      weatherAssessmentAt: new Date(worsening?.at ?? now).toISOString(),
      eligiblePlaceIds: places.ok ? places.value.map(place => place.placeId) : []
    }
  } };
}

// Run once all required needs have been attempted. Missing/not_requested required evidence is not
// permission to call Bedrock. Provider orchestration, timeouts, model calls and delivery stay in D.
export function refineCandidates(input: RefineCandidatesInput): CandidateRefinementResult {
  const policy = detectorPolicy(input.policy);
  const evidence = CandidateEvidenceSchema.parse(input.evidence);
  const candidates = CandidateOpportunitySchema.array().parse(input.candidates);
  const coreSignals = new Set<SignalName>(['time', 'location', 'calendar', 'preferences']);
  if (input.context.activity?.stepsToday !== undefined && input.context.activity.stepsToday !== null) coreSignals.add('steps');
  const providerSignals = new Set<SignalName>(['weather', 'places', 'transit']);
  const explicitSignals = input.availableSignals ? new Set(SignalNameSchema.array().parse(input.availableSignals)) : undefined;
  const kept: CandidateOpportunity[] = [];
  const exclusions: CandidateExclusion[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.type, candidate.anchorKey]);
    if (seen.has(key)) continue;
    seen.add(key);
    const seed = seedFor(candidate, input.context, policy);
    // Rebuild facts from normalized context, so stale/tampered candidate facts cannot invent evidence.
    if ((seed ?? candidate).requiredSignals.some(signal => explicitSignals ? !explicitSignals.has(signal)
      : !providerSignals.has(signal) && !coreSignals.has(signal))) {
      exclusions.push(excluded(candidate, 'MISSING_REQUIRED_SIGNAL'));
      continue;
    }
    if (!seed) { exclusions.push(excluded(candidate, null)); continue; }
    const result: Assessment = (() => {
      switch (seed.type) {
        case 'UPCOMING_EVENT_TRANSIT': return assessUpcoming(seed, input.context, evidence, policy);
        case 'FREE_TIME_NEARBY':
        case 'EARLY_ARRIVAL_DETOUR': return assessActivity(seed, input.context, evidence, policy);
        case 'WEATHER_ADAPTATION': return assessWeather(seed, input.context, evidence, policy, explicitSignals?.has('calendar') ?? true);
        case 'STEP_GOAL_REST': {
          const places = placesFor(evidence, 'places-near-current', 'current');
          if (!places.ok) return places;
          return { ok: true, value: places.value.length ? { ...seed, facts: {
            ...seed.facts, eligiblePlaceIds: places.value.map(place => place.placeId)
          } } : null };
        }
      }
    })();
    if (result.ok && result.value) kept.push(CandidateOpportunitySchema.parse(result.value));
    else exclusions.push(excluded(seed, result.ok ? null : result.code, result.reason));
  }
  return { candidates: kept, exclusions };
}
