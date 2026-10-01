import type {
  CandidateDiagnosticCode, CandidateEvidence, DetectorPolicy, GeocodedPlace, GeoPoint,
  ProviderNeed, ProviderPlace, RouteSummary, WeatherSnapshot
} from '@contextia/contracts';
import { distanceMeters, MINUTE_MS } from './calendar.js';

export type EvidenceResult<T> = { ok: true; value: T } | { ok: false; code: CandidateDiagnosticCode };

export function destinationFor(eventId: string, evidence: CandidateEvidence, policy: Readonly<DetectorPolicy>): EvidenceResult<GeocodedPlace> {
  const entries = evidence.geocoding.filter(entry => entry.eventId === eventId);
  if (entries.length !== 1) return { ok: false, code: entries.length ? 'GEOCODE_AMBIGUOUS' : 'PROVIDER_UNAVAILABLE' };
  const result = entries[0]?.result;
  if (!result || (result.status !== 'ok' && result.status !== 'degraded')) return {
    ok: false, code: result?.code === 'GEOCODE_AMBIGUOUS' || result?.code === 'AMBIGUOUS' ? 'GEOCODE_AMBIGUOUS' : 'PROVIDER_UNAVAILABLE'
  };
  const unique = new Map<string, GeocodedPlace>();
  for (const place of result.data) {
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
      const elapsed = Date.parse(route.arriveAt) - Date.parse(route.departAt);
      // Only tolerate floating-point rounding of provider seconds converted to minutes.
      if (elapsed < 0 || elapsed + 0.001 < route.durationMinutes * MINUTE_MS) return [];
    }
    return [route];
  });
}

export type WeatherReading = Pick<WeatherSnapshot,
  'condition' | 'temperatureCelsius' | 'feelsLikeCelsius' | 'precipitationProbability' | 'precipitationMillimeters'> & {
    source: 'current' | 'forecast'; sourceTimestamp: string;
  };

export function weatherAt(evidence: CandidateEvidence, at: number, policy: Readonly<DetectorPolicy>): WeatherReading | null {
  const snapshots = evidence.weather.flatMap(entry =>
    entry.result.status === 'ok' || entry.result.status === 'degraded' ? [entry.result.data] : [])
    .sort((a, b) => Date.parse(b.sourceTimestamp) - Date.parse(a.sourceTimestamp));
  for (const snapshot of snapshots) {
    const sourceAt = Date.parse(snapshot.sourceTimestamp);
    const current = sourceAt <= at && at < sourceAt + policy.currentWeatherMaxAgeMinutes * MINUTE_MS;
    const window = snapshot.forecast.find(value => Date.parse(value.startAt) <= at && at < Date.parse(value.endAt));
    const values = current ? snapshot : window;
    if (!values) continue;
    return {
      source: current ? 'current' : 'forecast', sourceTimestamp: snapshot.sourceTimestamp,
      condition: values.condition, temperatureCelsius: values.temperatureCelsius,
      ...(values.feelsLikeCelsius === undefined ? {} : { feelsLikeCelsius: values.feelsLikeCelsius }),
      precipitationProbability: values.precipitationProbability, precipitationMillimeters: values.precipitationMillimeters
    };
  }
  return null;
}

// Scheduled transit must supply both timestamps. Timeless pedestrian duration is provider evidence,
// not an invented transit timetable. The resulting instant is an internal feasibility calculation.
export function journeyArrival(route: RouteSummary, earliestDeparture: number): number | null {
  if (route.mode !== 'pedestrian' && (!route.departAt || !route.arriveAt)) return null;
  const departure = route.departAt ? Date.parse(route.departAt) : earliestDeparture;
  if (departure < earliestDeparture) return null;
  const minimumArrival = departure + route.durationMinutes * MINUTE_MS;
  const arrival = route.arriveAt ? Date.parse(route.arriveAt) : minimumArrival;
  return arrival < departure || arrival + 0.001 < minimumArrival ? null : arrival;
}
