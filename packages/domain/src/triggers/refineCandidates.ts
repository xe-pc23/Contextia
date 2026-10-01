import { CandidateEvidenceSchema, CandidateOpportunitySchema, SignalNameSchema } from '@contextia/contracts';
import type {
  CandidateDiagnosticCode, CandidateEvidence, CandidateOpportunity, DetectorPolicy, GeoPoint, ProviderPlace, SignalName
} from '@contextia/contracts';
import { calendarWindow, distanceMeters, evaluationMillis, hasEventLocation, MINUTE_MS } from './calendar.js';
import {
  generateEarlyArrivalDetourCandidates, generateFreeTimeNearbyCandidates,
  generateUpcomingEventTransitCandidates, generateWeatherAdaptationCandidates
} from './candidateGeneration.js';
import type { DetectorContext } from './detectorContext.js';
import { detectorPolicy } from './detectorPolicy.js';
import { destinationFor, journeyArrival, matchingRoutes, placesFor, weatherAt } from './evidence.js';
import type { EvidenceResult } from './evidence.js';
import { generateStepGoalRestCandidates } from './stepGoalRest.js';

export interface CandidateExclusion {
  readonly type: CandidateOpportunity['type'];
  readonly anchorKey: string;
  // null: supplied facts do not justify this opportunity. Other codes are candidate diagnostics,
  // never global delivery guards and never appended to delivery.wouldSuppress.
  readonly code: CandidateDiagnosticCode | null;
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

function excluded(candidate: CandidateOpportunity, code: CandidateDiagnosticCode | null): CandidateExclusion {
  return { type: candidate.type, anchorKey: candidate.anchorKey, code };
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
  context: DetectorContext, places: ProviderPlace[], target: GeoPoint, deadline: number,
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
        const latestDeparture = back.departAt ? Date.parse(back.departAt)
          : Math.min(deadline, back.arriveAt ? Date.parse(back.arriveAt) : deadline) - back.durationMinutes * MINUTE_MS;
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

type Assessment = EvidenceResult<CandidateOpportunity | null>;

function assessUpcoming(
  seed: CandidateOpportunity, context: DetectorContext, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>
): Assessment {
  const event = calendarWindow(context).nextTimedEvent;
  if (!event) return { ok: false, code: 'MISSING_REQUIRED_SIGNAL' };
  const destination = destinationFor(event.id, evidence, policy);
  if (!destination.ok) return destination;
  const routes = matchingRoutes(evidence, 'route-to-next-event', event.id, context.location, destination.value, policy)
    .filter(route => route.mode === 'transit' || route.mode === 'intermodal');
  if (!routes.length) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  const now = evaluationMillis(context);
  const deadline = Date.parse(event.startAt) - policy.arrivalBufferMinutes * MINUTE_MS;
  for (const route of routes) {
    const departure = route.departAt ? Date.parse(route.departAt)
      : (route.arriveAt ? Date.parse(route.arriveAt) : deadline) - route.durationMinutes * MINUTE_MS;
    const arrival = route.arriveAt ? Date.parse(route.arriveAt) : departure + route.durationMinutes * MINUTE_MS;
    if (departure < now || departure > now + policy.departureLeadMinutes * MINUTE_MS || arrival > deadline) continue;
    return { ok: true, value: {
      ...seed, confidence: Math.min(seed.confidence, destination.value.confidence),
      facts: {
        ...seed.facts, destinationPlaceId: destination.value.placeId, routeId: route.routeId,
        routeDurationMinutes: route.durationMinutes, latestDepartureAt: new Date(departure).toISOString(),
        departureSource: route.departAt ? 'provider' : 'duration-budget',
        ...(route.departAt ? { providerDepartAt: route.departAt } : {}),
        ...(route.arriveAt ? { providerArriveAt: route.arriveAt } : {})
      }
    } };
  }
  return { ok: true, value: null };
}

function assessActivity(
  seed: CandidateOpportunity, context: DetectorContext, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>
): Assessment {
  const early = seed.type === 'EARLY_ARRIVAL_DETOUR';
  const window = calendarWindow(context);
  const event = early ? window.nextTimedEvent : window.nextEvent;
  let target: GeoPoint = context.location;
  let destinationPlaceId: string | undefined;
  if (event && hasEventLocation(event)) {
    const destination = destinationFor(event.id, evidence, policy);
    if (!destination.ok) return destination;
    target = destination.value;
    destinationPlaceId = destination.value.placeId;
  }
  const distance = distanceMeters(context.location, target);
  if (early && distance + (context.location.accuracyMeters ?? 0) > policy.earlyArrivalRadiusMeters) return { ok: true, value: null };
  const now = evaluationMillis(context);
  const end = Math.min(now + policy.maximumFreeTimeMinutes * MINUTE_MS, event ? Date.parse(event.startAt) : Number.POSITIVE_INFINITY);
  const deadline = end - (event ? policy.arrivalBufferMinutes : 0) * MINUTE_MS;
  const nearby = placesFor(evidence, early ? 'places-near-destination' : 'places-near-current', early && event ? event.id : 'current');
  if (!nearby.ok) return nearby;
  if (!nearby.value.length) return { ok: true, value: null };
  const budgets = activityBudgets(context, nearby.value, target, deadline, evidence, policy);
  if (!budgets.length) {
    const hasRoutes = nearby.value.some(place => {
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
      ...(destinationPlaceId ? { destinationPlaceId } : {}),
      ...(early ? { destinationDistanceMeters: distance, accuracyMeters: context.location.accuracyMeters ?? null } : {})
    }
  } };
}

function assessWeather(
  seed: CandidateOpportunity, context: DetectorContext, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>
): Assessment {
  const weather = weatherAt(evidence, evaluationMillis(context), policy);
  if (!weather) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  const wet = ['rain', 'snow', 'storm'].includes(weather.condition) ||
    (weather.precipitationMillimeters ?? 0) >= policy.precipitationThresholdMillimeters ||
    (weather.precipitationProbability ?? 0) >= policy.precipitationProbabilityThreshold;
  const temperature = weather.feelsLikeCelsius ?? weather.temperatureCelsius;
  const hot = temperature !== null && temperature >= policy.heatThresholdCelsius;
  if (!wet && !hot) return { ok: true, value: null };
  const places = placesFor(evidence, 'places-near-current', 'current');
  return { ok: true, value: { ...seed, facts: {
    ...seed.facts, weather, weatherIssues: [...(wet ? ['precipitation'] : []), ...(hot ? ['heat'] : [])],
    eligiblePlaceIds: places.ok ? places.value.map(place => place.placeId) : []
  } } };
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
        case 'WEATHER_ADAPTATION': return assessWeather(seed, input.context, evidence, policy);
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
    else exclusions.push(excluded(seed, result.ok ? null : result.code));
  }
  return { candidates: kept, exclusions };
}
