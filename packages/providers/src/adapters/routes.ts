import { createHash } from 'node:crypto';
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import type { CalculateRoutesCommandInput } from '@aws-sdk/client-geo-routes';
import { GeoPointSchema, RouteAttributionSchema, RouteModeSchema, RouteSummarySchema, TimestampSchema } from '@contextia/contracts';
import type { ProviderResult, RouteSummary } from '@contextia/contracts';
import { z } from 'zod';
import type { RouteInput, RouteProvider } from '../ports/RouteProvider.js';
import { available, elapsedSince, mapAwsError, unavailable, withTimeout } from './shared.js';

const RouteInputSchema = z.strictObject({
  origin: GeoPointSchema,
  destination: GeoPointSchema,
  mode: RouteModeSchema,
  departAt: TimestampSchema.optional(),
  arriveBy: TimestampSchema.optional()
}).refine(input => input.departAt === undefined || input.arriveBy === undefined, 'Choose departure or arrival planning, not both');

const NoticeSchema = z.object({ Code: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/) }).passthrough();
const TimedPointSchema = z.object({
  Time: TimestampSchema.optional(), Status: z.enum(['Added', 'Cancelled', 'Replaced', 'Scheduled']).optional()
}).passthrough();
const AwsSecondsSchema = z.number().int().nonnegative();
const TravelStepSchema = z.object({ Duration: AwsSecondsSchema }).passthrough();
const RawAttributionSchema = z.object({
  AttributionType: z.enum(['Disclaimer', 'Tariff']).optional(),
  WebLink: z.object({ Description: z.string().min(1), AnchorText: z.string().optional(),
    Url: z.string().optional() }).passthrough()
}).passthrough();
const LegDetailsSchema = z.object({
  Departure: TimedPointSchema.optional(),
  Arrival: TimedPointSchema.optional(),
  BeforeTravelSteps: z.array(TravelStepSchema).optional(),
  AfterTravelSteps: z.array(TravelStepSchema).optional(),
  Summary: z.object({
    Overview: z.object({ Duration: AwsSecondsSchema.optional() }).passthrough().optional(),
    TravelOnly: z.object({ Duration: AwsSecondsSchema.optional() }).passthrough().optional()
  }).passthrough().optional(),
  Transport: z.object({
    RouteName: z.string().optional(), ShortRouteName: z.string().optional(), LongRouteName: z.string().optional()
  }).passthrough().optional(),
  Notices: z.array(NoticeSchema).optional(),
  Attributions: z.array(RawAttributionSchema).optional()
}).passthrough();
const TravelModeSchema = z.enum([
  'Car', 'Ferry', 'Pedestrian', 'Scooter', 'Truck', 'CarShuttleTrain', 'AerialTramway', 'Airplane',
  'Bus', 'BusRapidTransit', 'CityTrain', 'FunicularRailway', 'HighSpeedTrain', 'IntercityTrain',
  'InterregionalTrain', 'LightRail', 'Monorail', 'PrivateBus', 'RegionalTrain', 'Subway'
]);
const RawLegSchema = z.object({
  Type: z.enum(['Ferry', 'Pedestrian', 'Vehicle', 'Rental', 'Taxi', 'Transit']),
  TravelMode: TravelModeSchema,
  FerryLegDetails: LegDetailsSchema.optional(),
  PedestrianLegDetails: LegDetailsSchema.optional(),
  VehicleLegDetails: LegDetailsSchema.optional(),
  RentalLegDetails: LegDetailsSchema.optional(),
  TaxiLegDetails: LegDetailsSchema.optional(),
  TransitLegDetails: LegDetailsSchema.optional()
}).passthrough();
const RawRouteSchema = z.object({
  Legs: z.array(RawLegSchema).min(1),
  Summary: z.object({
    Duration: AwsSecondsSchema.optional(), Distance: z.number().nonnegative().optional()
  }).passthrough().optional()
}).passthrough();
const RoutesResponseSchema = z.object({
  Routes: z.array(z.unknown()), Notices: z.array(NoticeSchema).optional()
}).passthrough();

export interface AmazonLocationCalculateRoutesRequest {
  Origin: [number, number];
  Destination: [number, number];
  TravelMode: 'Transit' | 'Intermodal' | 'Pedestrian';
  DepartureTime?: string;
  ArrivalTime?: string;
  DepartNow?: true;
  LegAdditionalFeatures: ['Summary'];
  MaxAlternatives: 0;
}

export interface AmazonLocationRoutesClient {
  calculateRoutes(input: AmazonLocationCalculateRoutesRequest, signal: AbortSignal): Promise<unknown>;
}

export interface AmazonLocationRoutesConfig {
  region: string;
  timeoutMs: number;
}

export interface AmazonLocationRoutesAdapterOptions extends AmazonLocationRoutesConfig {
  client: AmazonLocationRoutesClient;
}

type RawLeg = z.infer<typeof RawLegSchema>;
type LegDetails = z.infer<typeof LegDetailsSchema>;
interface LegTiming {
  durationSeconds: number;
  beforeSeconds: number;
  afterSeconds: number;
  departure: bigint | undefined;
  arrival: bigint | undefined;
}
type NormalizedRoute =
  | { status: 'ok' | 'degraded'; data: RouteSummary; code?: string }
  | { status: 'unavailable' | 'error'; data: null; code: string };

function detailsFor(leg: RawLeg): LegDetails | undefined {
  switch (leg.Type) {
    case 'Ferry': return leg.FerryLegDetails;
    case 'Pedestrian': return leg.PedestrianLegDetails;
    case 'Vehicle': return leg.VehicleLegDetails;
    case 'Rental': return leg.RentalLegDetails;
    case 'Taxi': return leg.TaxiLegDetails;
    case 'Transit': return leg.TransitLegDetails;
  }
}

function normalizeMode(mode: RawLeg['TravelMode']): RouteSummary['legs'][number]['mode'] {
  switch (mode) {
    case 'Pedestrian': return 'pedestrian';
    case 'Bus': case 'BusRapidTransit': case 'PrivateBus': return 'bus';
    case 'CityTrain': case 'FunicularRailway': case 'HighSpeedTrain': case 'IntercityTrain':
    case 'InterregionalTrain': case 'Monorail': case 'RegionalTrain': case 'CarShuttleTrain': return 'rail';
    case 'LightRail': return 'tram';
    case 'Subway': return 'subway';
    case 'Ferry': return 'ferry';
    default: return 'other';
  }
}

function failedRoute(status: 'unavailable' | 'error', code: string): NormalizedRoute {
  return { status, data: null, code };
}

const NANOS_PER_SECOND = 1_000_000_000n;
function timestampNanos(value: string): bigint {
  const fraction = /\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '';
  const submillisecondNanos = Number(fraction.padEnd(9, '0')) % 1_000_000;
  return BigInt(Date.parse(value)) * 1_000_000n + BigInt(submillisecondNanos);
}

function ceilSeconds(nanos: bigint): number {
  return Number((nanos + NANOS_PER_SECOND - 1n) / NANOS_PER_SECOND);
}

function agreesWithIntegerSeconds(reported: number, measuredNanos: bigint): boolean {
  const difference = BigInt(reported) * NANOS_PER_SECOND - measuredNanos;
  return measuredNanos % NANOS_PER_SECOND === 0n ? difference === 0n
    : difference > -NANOS_PER_SECOND && difference < NANOS_PER_SECOND;
}

function normalizeRoute(raw: unknown, input: z.infer<typeof RouteInputSchema>, notices: z.infer<typeof NoticeSchema>[]): NormalizedRoute {
  const parsed = RawRouteSchema.safeParse(raw);
  if (!parsed.success) return failedRoute('error', 'INVALID_RESPONSE');
  const route = parsed.data;
  const warnings = notices.map(notice => notice.Code);
  const legs: RouteSummary['legs'] = [];
  const attributions: NonNullable<RouteSummary['attributions']> = [];
  const timings: LegTiming[] = [];
  let transitLegCount = 0;
  let previousArrival: bigint | undefined;
  let fractionalTiming = false;
  for (const rawLeg of route.Legs) {
    if (input.mode === 'pedestrian' && ['Transit', 'Vehicle', 'Rental', 'Taxi'].includes(rawLeg.Type)) {
      return failedRoute('error', 'INVALID_RESPONSE');
    }
    const details = detailsFor(rawLeg);
    if (details === undefined) return input.mode === 'pedestrian'
      ? failedRoute('error', 'INVALID_RESPONSE') : failedRoute('unavailable', 'SCHEDULE_UNAVAILABLE');
    if (rawLeg.Type === 'Pedestrian' && rawLeg.TravelMode !== 'Pedestrian') return failedRoute('error', 'INVALID_RESPONSE');
    if (rawLeg.Type === 'Transit' && ['Car', 'Pedestrian', 'Scooter', 'Truck', 'CarShuttleTrain'].includes(rawLeg.TravelMode)) {
      return failedRoute('error', 'INVALID_RESPONSE');
    }
    warnings.push(...(details.Notices ?? []).map(notice => notice.Code));
    for (const source of details.Attributions ?? []) {
      const attribution = RouteAttributionSchema.safeParse({
        text: source.WebLink.AnchorText?.trim() || source.WebLink.Description.trim(),
        ...(source.WebLink.Url === undefined ? {} : { url: source.WebLink.Url }),
        ...(source.AttributionType === undefined ? {} : { type: source.AttributionType })
      });
      if (!attribution.success) return failedRoute('error', 'INVALID_RESPONSE');
      if (!attributions.some(item => item.text === attribution.data.text && item.url === attribution.data.url
        && item.type === attribution.data.type)) attributions.push(attribution.data);
    }
    const departAt = details.Departure?.Time;
    const arriveAt = details.Arrival?.Time;
    if (rawLeg.Type === 'Transit' && [details.Departure?.Status, details.Arrival?.Status]
      .some(status => status === 'Cancelled' || status === 'Replaced')) {
      return failedRoute('unavailable', 'SCHEDULE_UNAVAILABLE');
    }
    if (input.mode !== 'pedestrian' && (departAt === undefined || arriveAt === undefined)) {
      return failedRoute('unavailable', 'SCHEDULE_UNAVAILABLE');
    }
    const departure = departAt === undefined ? undefined : timestampNanos(departAt);
    const arrival = arriveAt === undefined ? undefined : timestampNanos(arriveAt);
    if ((departure !== undefined && arrival !== undefined && arrival < departure)
      || (previousArrival !== undefined && departure !== undefined && departure < previousArrival)) {
      return failedRoute('error', 'INVALID_RESPONSE');
    }
    previousArrival = arrival;
    const scheduleNanos = departure !== undefined && arrival !== undefined ? arrival - departure : undefined;
    const fractionalSchedule = scheduleNanos !== undefined && scheduleNanos % NANOS_PER_SECOND !== 0n;
    fractionalTiming ||= fractionalSchedule;
    const roundedScheduleSeconds = scheduleNanos === undefined ? undefined : ceilSeconds(scheduleNanos);
    const beforeSeconds = (details.BeforeTravelSteps ?? []).reduce((total, step) => total + step.Duration, 0);
    const afterSeconds = (details.AfterTravelSteps ?? []).reduce((total, step) => total + step.Duration, 0);
    const reportedTravelSeconds = details.Summary?.TravelOnly?.Duration;
    const travelSeconds = reportedTravelSeconds ?? roundedScheduleSeconds;
    // Overview includes before/after steps; departure/arrival describe the travel portion.
    const reportedDurationSeconds = details.Summary?.Overview?.Duration;
    const conservativeDurationSeconds = travelSeconds === undefined ? undefined
      : beforeSeconds + Math.max(travelSeconds, roundedScheduleSeconds ?? 0) + afterSeconds;
    const durationSeconds = reportedDurationSeconds === undefined ? conservativeDurationSeconds
      : Math.max(reportedDurationSeconds, conservativeDurationSeconds ?? 0);
    if (durationSeconds === undefined) return failedRoute('error', 'INVALID_RESPONSE');
    if ((departure === undefined) !== (arrival === undefined)
      || (scheduleNanos !== undefined && reportedTravelSeconds !== undefined
        && !agreesWithIntegerSeconds(reportedTravelSeconds, scheduleNanos))
      || (reportedDurationSeconds !== undefined && travelSeconds !== undefined
        && Math.abs(reportedDurationSeconds - (beforeSeconds + travelSeconds + afterSeconds)) > (fractionalSchedule ? 1 : 0))
      || durationSeconds < beforeSeconds + afterSeconds) {
      return failedRoute('unavailable', 'DURATION_UNRESOLVED');
    }
    timings.push({ durationSeconds, beforeSeconds, afterSeconds, departure, arrival });
    const lineName = details.Transport?.RouteName?.trim()
      || details.Transport?.ShortRouteName?.trim()
      || details.Transport?.LongRouteName?.trim();
    legs.push({
      mode: normalizeMode(rawLeg.TravelMode), durationMinutes: durationSeconds / 60,
      ...(departAt === undefined ? {} : { departAt }),
      ...(arriveAt === undefined ? {} : { arriveAt }),
      ...(lineName ? { lineName } : {})
    });
    if (rawLeg.Type === 'Transit') transitLegCount += 1;
  }
  if (input.mode !== 'pedestrian' && warnings.includes('NoSchedule')) return failedRoute('unavailable', 'SCHEDULE_UNAVAILABLE');
  if (input.mode === 'transit' && transitLegCount === 0) return failedRoute('unavailable', 'NO_TRANSIT_ROUTE');
  const departAt = legs[0]?.departAt;
  const arriveAt = legs.at(-1)?.arriveAt;
  if ((input.departAt !== undefined && departAt !== undefined && timestampNanos(departAt) < timestampNanos(input.departAt))
    || (input.arriveBy !== undefined && arriveAt !== undefined && timestampNanos(arriveAt) > timestampNanos(input.arriveBy))) {
    return failedRoute('unavailable', 'PLANNING_TIME_UNSATISFIED');
  }
  let durationSeconds = timings.reduce((total, timing) => total + timing.durationSeconds, 0);
  const scheduled = timings.every(timing => timing.departure !== undefined && timing.arrival !== undefined);
  if (scheduled) {
    // Outer before/after steps require route boundary times that the provider has not returned.
    // Do not shift a travel timestamp and claim it is a supplied route departure/arrival.
    if (timings[0]!.beforeSeconds > 0 || timings.at(-1)!.afterSeconds > 0) {
      return failedRoute('unavailable', 'DURATION_UNRESOLVED');
    }
    for (let index = 1; index < timings.length; index += 1) {
      const previous = timings[index - 1]!;
      const current = timings[index]!;
      const gapNanos = current.departure! - previous.arrival!;
      fractionalTiming ||= gapNanos % NANOS_PER_SECOND !== 0n;
      const accountedSeconds = previous.afterSeconds + current.beforeSeconds;
      const accountedNanos = BigInt(accountedSeconds) * NANOS_PER_SECOND;
      if (gapNanos < accountedNanos && (gapNanos % NANOS_PER_SECOND === 0n
        || gapNanos + NANOS_PER_SECOND <= accountedNanos)) return failedRoute('unavailable', 'DURATION_UNRESOLVED');
      // Parking/boarding steps are already in the overviews; add only the remaining wait.
      durationSeconds += gapNanos > accountedNanos ? ceilSeconds(gapNanos - accountedNanos) : 0;
    }
  } else if (timings.some(timing => timing.departure !== undefined || timing.arrival !== undefined)) {
    return failedRoute('unavailable', 'DURATION_UNRESOLVED');
  }
  // A shorter travel-only route summary is safe to replace with fully reconciled leg/wait evidence.
  // A longer, unexplained summary could hide required time: do not return a shorter usable route.
  if (route.Summary?.Duration !== undefined) {
    if (route.Summary.Duration > durationSeconds + (fractionalTiming ? 1 : 0)) return failedRoute('unavailable', 'DURATION_UNRESOLVED');
    if (route.Summary.Duration !== durationSeconds) warnings.push('DURATION_MISMATCH');
    durationSeconds = Math.max(durationSeconds, route.Summary.Duration);
  }
  const normalizedFacts = {
    mode: input.mode, origin: input.origin, destination: input.destination,
    durationMinutes: durationSeconds / 60,
    ...(route.Summary?.Distance === undefined ? {} : { distanceMeters: route.Summary.Distance }),
    ...(departAt === undefined ? {} : { departAt }),
    ...(arriveAt === undefined ? {} : { arriveAt }),
    // Count changes between transit boardings, excluding access/egress pedestrian legs.
    ...(transitLegCount > 0 ? { transfers: transitLegCount - 1 } : {}),
    ...(attributions.length > 0 ? { attributions } : {}),
    legs, warnings: [...new Set(warnings)]
  };
  const routeId = `amazon-location-route:${createHash('sha256').update(JSON.stringify(normalizedFacts)).digest('hex').slice(0, 32)}`;
  const normalized = RouteSummarySchema.safeParse({ routeId, ...normalizedFacts });
  if (!normalized.success) return failedRoute('error', 'INVALID_RESPONSE');
  return normalized.data.warnings.length === 0
    ? { status: 'ok', data: normalized.data }
    : { status: 'degraded', data: normalized.data, code: warnings.includes('DURATION_MISMATCH') ? 'DURATION_MISMATCH' : 'ROUTE_NOTICES' };
}

export class AmazonLocationRouteProvider implements RouteProvider {
  private readonly client: AmazonLocationRoutesClient;
  private readonly region: string;
  private readonly timeoutMs: number;

  constructor(options: AmazonLocationRoutesAdapterOptions) {
    this.client = options.client;
    this.region = options.region;
    this.timeoutMs = options.timeoutMs;
  }

  async getRoute(input: RouteInput): Promise<ProviderResult<RouteSummary>> {
    const parsedInput = RouteInputSchema.safeParse(input);
    if (!parsedInput.success) return { status: 'error', data: null, code: 'INVALID_REQUEST' };
    const value = parsedInput.data;
    // These documented GrabMaps regions do not offer Transit/Intermodal requests.
    if (value.mode !== 'pedestrian' && ['ap-southeast-1', 'ap-southeast-5'].includes(this.region)) {
      return { status: 'unavailable', data: null, code: 'UNSUPPORTED_REGION' };
    }
    const request: AmazonLocationCalculateRoutesRequest = {
      Origin: [value.origin.longitude, value.origin.latitude],
      Destination: [value.destination.longitude, value.destination.latitude],
      TravelMode: value.mode === 'transit' ? 'Transit' : value.mode === 'intermodal' ? 'Intermodal' : 'Pedestrian',
      ...(value.departAt !== undefined ? { DepartureTime: value.departAt }
        : value.arriveBy !== undefined ? { ArrivalTime: value.arriveBy } : { DepartNow: true as const }),
      LegAdditionalFeatures: ['Summary'], MaxAlternatives: 0
    };
    const startedAt = performance.now();
    try {
      const response = await withTimeout(signal => this.client.calculateRoutes(request, signal), this.timeoutMs);
      const parsedResponse = RoutesResponseSchema.safeParse(response);
      if (!parsedResponse.success) return unavailable('error', elapsedSince(startedAt), 'INVALID_RESPONSE');
      if (parsedResponse.data.Routes.length === 0) return unavailable('unavailable', elapsedSince(startedAt), 'NO_ROUTE');
      let failure: NormalizedRoute | undefined;
      for (const route of parsedResponse.data.Routes) {
        const result = normalizeRoute(route, value, parsedResponse.data.Notices ?? []);
        if (result.status === 'ok' || result.status === 'degraded') {
          return available(result.status, result.data, elapsedSince(startedAt), result.code);
        }
        failure ??= result;
      }
      return unavailable(failure?.status === 'unavailable' ? 'unavailable' : 'error', elapsedSince(startedAt), failure?.code ?? 'INVALID_RESPONSE');
    } catch (error: unknown) {
      const mapped = mapAwsError(error);
      return unavailable(mapped.status, elapsedSince(startedAt), mapped.code);
    }
  }
}

export function createAmazonLocationRouteProvider(
  config: AmazonLocationRoutesConfig,
  clientOverride?: AmazonLocationRoutesClient
): AmazonLocationRouteProvider {
  const sdk = clientOverride === undefined ? new GeoRoutesClient({ region: config.region, maxAttempts: 1 }) : undefined;
  const client = clientOverride ?? {
    calculateRoutes: (input: AmazonLocationCalculateRoutesRequest, signal: AbortSignal) => {
      const request: CalculateRoutesCommandInput = input;
      return sdk!.send(new CalculateRoutesCommand(request), { abortSignal: signal });
    }
  };
  return new AmazonLocationRouteProvider({ ...config, client });
}
