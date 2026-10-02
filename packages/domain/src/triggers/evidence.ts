import type {
  CandidateDiagnosticCode, CandidateEvidence, ContextInput, DetectorPolicy, GeocodedPlace, GeoPoint,
  ProviderNeed, ProviderPlace, RouteSummary, WeatherSnapshot
} from '@contextia/contracts';
import { ceilNanosecondsToMilliseconds, scheduledDurationMilliseconds, timestampNanoseconds } from '@contextia/contracts';
import { distanceMeters, MINUTE_MS } from './calendar.js';

export type EvidenceResult<T> = { ok: true; value: T } | { ok: false; code: CandidateDiagnosticCode };

export function destinationFor(eventId: string, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>): EvidenceResult<GeocodedPlace> {
  const results = evidence.geocoding.filter(entry => entry.eventId === eventId).map(entry => entry.result);
  const usable = results.flatMap(result => result.status === 'ok' || result.status === 'degraded' ? [result.data] : []);
  if (!usable.length) return {
    ok: false, code: results.some(result => result.code === 'GEOCODE_AMBIGUOUS' || result.code === 'AMBIGUOUS')
      ? 'GEOCODE_AMBIGUOUS' : 'PROVIDER_UNAVAILABLE'
  };
  const unique = new Map<string, GeocodedPlace>();
  for (const place of usable.flat()) {
    if (place.confidence < policy.minimumGeocodeConfidence) continue;
    const previous = unique.get(place.placeId);
    if (previous && distanceMeters(previous, place) > 1) return { ok: false, code: 'GEOCODE_AMBIGUOUS' };
    if (!previous || place.confidence > previous.confidence) unique.set(place.placeId, place);
  }
  const places = [...unique.values()];
  const place = places[0];
  if (places.length !== 1 || !place) return { ok: false, code: 'GEOCODE_AMBIGUOUS' };
  return { ok: true, value: place };
}

export function placesFor(
  evidence: CandidateEvidence, need: Extract<ProviderNeed, 'places-near-current' | 'places-near-destination'>, anchorKey: string
): EvidenceResult<ProviderPlace[]> {
  const entries = evidence.places.filter(entry => entry.need === need && entry.anchorKey === anchorKey);
  const unique = new Map<string, ProviderPlace>();
  const conflicting = new Set<string>();
  let available = false;
  for (const entry of entries) {
    if (entry.result.status !== 'ok' && entry.result.status !== 'degraded') continue;
    available = true;
    for (const place of entry.result.data) {
      const previous = unique.get(place.placeId);
      if (previous && distanceMeters(previous, place) > 1) conflicting.add(place.placeId);
      if (!previous || (place.isOpen === true && previous.isOpen !== true)) unique.set(place.placeId, place);
    }
  }
  if (!available) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  return { ok: true, value: [...unique.values()]
    .filter(place => place.isOpen !== false && !conflicting.has(place.placeId))
    .sort((a, b) => Number(b.isOpen === true) - Number(a.isOpen === true)) };
}

export function matchingRoutes(
  evidence: CandidateEvidence, need: Extract<ProviderNeed, 'route-to-next-event' | 'route-to-place-candidates'>,
  anchorKey: string, origin: GeoPoint, destination: GeoPoint, policy: Readonly<DetectorPolicy>
): RouteSummary[] {
  return evidence.routes.flatMap(entry => {
    if (entry.need !== need || entry.anchorKey !== anchorKey ||
      (entry.result.status !== 'ok' && entry.result.status !== 'degraded')) return [];
    const route = entry.result.data;
    if (distanceMeters(route.origin, origin) > policy.routeEndpointToleranceMeters ||
      distanceMeters(route.destination, destination) > policy.routeEndpointToleranceMeters) return [];
    if (route.departAt && route.arriveAt) {
      const elapsed = scheduledDurationMilliseconds(route.departAt, route.arriveAt);
      // Only tolerate floating-point rounding of provider seconds converted to minutes.
      if (elapsed === null || elapsed + 0.001 < route.durationMinutes * MINUTE_MS) return [];
    }
    return [route];
  });
}

type WeatherValues = Pick<WeatherSnapshot,
  'condition' | 'temperatureCelsius' | 'feelsLikeCelsius' | 'precipitationProbability' | 'precipitationMillimeters'>;
export type WeatherReading = WeatherValues & { sourceTimestamp: string } & (
  { source: 'current' } | { source: 'forecast'; startAt: string; endAt: string }
);

function weatherSnapshots(evidence: CandidateEvidence): WeatherSnapshot[] {
  return evidence.weather.flatMap(entry =>
    entry.result.status === 'ok' || entry.result.status === 'degraded' ? [entry.result.data] : [])
    .sort((a, b) => Date.parse(b.sourceTimestamp) - Date.parse(a.sourceTimestamp));
}

function weatherValues(values: WeatherValues): WeatherValues {
  return {
    condition: values.condition, temperatureCelsius: values.temperatureCelsius,
    ...(values.feelsLikeCelsius === undefined ? {} : { feelsLikeCelsius: values.feelsLikeCelsius }),
    precipitationProbability: values.precipitationProbability, precipitationMillimeters: values.precipitationMillimeters
  };
}

function forecastReading(snapshot: WeatherSnapshot, window: WeatherSnapshot['forecast'][number]): WeatherReading {
  return {
    ...weatherValues(window), source: 'forecast', sourceTimestamp: snapshot.sourceTimestamp,
    startAt: window.startAt, endAt: window.endAt
  };
}

export function weatherAt(
  evidence: CandidateEvidence, at: number, policy: Readonly<DetectorPolicy>, mode: ContextInput['mode']
): WeatherReading | null {
  for (const snapshot of weatherSnapshots(evidence)) {
    const sourceAt = Date.parse(snapshot.sourceTimestamp);
    // Freshness makes an observation usable at real time; it cannot project that observation into a future simulation.
    const observationApplies = mode === 'real' || at === sourceAt;
    if (observationApplies && sourceAt <= at && at < sourceAt + policy.currentWeatherMaxAgeMinutes * MINUTE_MS) return {
      ...weatherValues(snapshot), source: 'current', sourceTimestamp: snapshot.sourceTimestamp
    };
    const window = snapshot.forecast.find(value => Date.parse(value.startAt) <= at && at < Date.parse(value.endAt));
    if (window) return forecastReading(snapshot, window);
  }
  return null;
}

// Inspect actual forecast coverage up to arrival, independently of current-observation freshness.
// Coverage changes at window starts/ends; at each instant the newest covering forecast wins.
export function forecastWeatherBetween(
  evidence: CandidateEvidence, from: number, through: number
): { at: number; weather: WeatherReading }[] {
  const snapshots = weatherSnapshots(evidence);
  const instants = new Set([from]);
  for (const snapshot of snapshots) for (const window of snapshot.forecast) {
    const start = Date.parse(window.startAt);
    const end = Date.parse(window.endAt);
    if (start >= end || end <= from || start > through) continue;
    if (start > from) instants.add(start);
    if (end <= through) instants.add(end);
  }
  const readings: { at: number; weather: WeatherReading }[] = [];
  for (const at of [...instants].sort((a, b) => a - b)) {
    for (const snapshot of snapshots) {
      const window = snapshot.forecast.find(value => Date.parse(value.startAt) <= at && at < Date.parse(value.endAt));
      if (!window) continue;
      readings.push({ at, weather: forecastReading(snapshot, window) });
      break;
    }
  }
  return readings;
}

// Scheduled transit must supply both timestamps. Timeless pedestrian duration is provider evidence,
// not an invented transit timetable. The resulting instant is an internal feasibility calculation.
export function journeyArrival(route: RouteSummary, earliestDeparture: number): number | null {
  if (route.mode !== 'pedestrian' && (!route.departAt || !route.arriveAt)) return null;
  if (route.departAt && route.arriveAt) {
    const duration = scheduledDurationMilliseconds(route.departAt, route.arriveAt);
    if (duration === null || duration + 0.001 < route.durationMinutes * MINUTE_MS
      || timestampNanoseconds(route.departAt) < BigInt(Math.ceil(earliestDeparture)) * 1_000_000n) return null;
    return ceilNanosecondsToMilliseconds(timestampNanoseconds(route.arriveAt));
  }
  const departure = route.departAt ? Date.parse(route.departAt) : earliestDeparture;
  if (departure < earliestDeparture) return null;
  const minimumArrival = departure + route.durationMinutes * MINUTE_MS;
  const arrival = route.arriveAt ? Date.parse(route.arriveAt) : minimumArrival;
  return arrival < departure || arrival + 0.001 < minimumArrival ? null : arrival;
}
