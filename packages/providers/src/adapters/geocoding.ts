import { GeocodeCommand, GeoPlacesClient } from '@aws-sdk/client-geo-places';
import type { GeocodeCommandInput } from '@aws-sdk/client-geo-places';
import { GeoPointSchema, GeocodedPlaceSchema } from '@contextia/contracts';
import type { GeocodedPlace, GeoPoint, ProviderResult } from '@contextia/contracts';
import { z } from 'zod';
import type { GeocodingInput, GeocodingProvider } from '../ports/GeocodingProvider.js';
import { elapsedSince, mapAwsError, withTimeout } from './shared.js';

export interface GeocodingPolicy {
  minConfidence: number;
  minScoreGap: number;
  maxBiasDistanceMeters: number;
}

export const defaultGeocodingPolicy: Readonly<GeocodingPolicy> = Object.freeze({
  minConfidence: 0.8,
  minScoreGap: 0.1,
  maxBiasDistanceMeters: 100_000
});

const PolicySchema = z.strictObject({
  minConfidence: z.number().min(0).max(1),
  minScoreGap: z.number().positive().max(1),
  maxBiasDistanceMeters: z.number().positive().finite()
});
export const GeocodingInputSchema = z.strictObject({
  queryText: z.string().trim().min(1).max(200),
  biasPosition: GeoPointSchema.optional(),
  locale: z.string().min(2).max(35).optional(),
  persistenceIntent: z.enum(['single-use', 'storage'])
});
const ResponseSchema = z.object({ ResultItems: z.array(z.unknown()).max(100) }).passthrough();
const ItemSchema = z.object({
  PlaceId: z.string().min(1).max(500),
  Title: z.string().trim().min(1).max(200),
  PlaceType: z.string(),
  Position: z.tuple([z.number().finite(), z.number().finite()]),
  Distance: z.number().nonnegative().optional(),
  MatchScores: z.object({ Overall: z.number().min(0).max(1).optional() }).passthrough().optional()
}).passthrough();
const DESTINATION_TYPES = new Set([
  'PointOfInterest', 'PointAddress', 'InterpolatedAddress', 'Intersection',
  'SecondaryAddress', 'InferredSecondaryAddress'
]);

function distanceMeters(left: GeoPoint, right: GeoPoint): number {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
}

/** Reject uncertainty before a destination can drive routing or model facts. */
export function normalizeGeocodingResults(
  response: unknown,
  input: GeocodingInput,
  policy: GeocodingPolicy = defaultGeocodingPolicy
): ProviderResult<GeocodedPlace[]> {
  const parsedPolicy = PolicySchema.safeParse(policy);
  if (!parsedPolicy.success) return { status: 'error', data: null, code: 'INVALID_POLICY' };
  const parsed = ResponseSchema.safeParse(response);
  if (!parsed.success) return { status: 'error', data: null, code: 'INVALID_RESPONSE' };
  if (parsed.data.ResultItems.length === 0) return { status: 'unavailable', data: null, code: 'GEOCODE_NOT_FOUND' };
  const matches = new Map<string, GeocodedPlace>();
  for (const raw of parsed.data.ResultItems) {
    const item = ItemSchema.safeParse(raw);
    if (!item.success) return { status: 'error', data: null, code: 'INVALID_RESPONSE' };
    const confidence = item.data.MatchScores?.Overall;
    if (confidence === undefined) return { status: 'unavailable', data: null, code: 'GEOCODE_LOW_CONFIDENCE' };
    if (!DESTINATION_TYPES.has(item.data.PlaceType)) {
      return { status: 'unavailable', data: null, code: 'GEOCODE_AMBIGUOUS' };
    }
    const [longitude, latitude] = item.data.Position;
    const normalized = GeocodedPlaceSchema.safeParse({
      provider: 'amazon-location', placeId: item.data.PlaceId, name: item.data.Title,
      latitude, longitude, confidence,
      ...(item.data.Distance === undefined ? {} : { distanceMeters: item.data.Distance })
    });
    if (!normalized.success) return { status: 'error', data: null, code: 'INVALID_RESPONSE' };
    const previous = matches.get(normalized.data.placeId);
    if (previous !== undefined && (previous.latitude !== latitude || previous.longitude !== longitude || previous.name !== normalized.data.name)) {
      return { status: 'error', data: null, code: 'INVALID_RESPONSE' };
    }
    if (previous === undefined || previous.confidence < confidence) matches.set(normalized.data.placeId, normalized.data);
  }
  const ranked = [...matches.values()].sort((left, right) => right.confidence - left.confidence);
  const best = ranked[0];
  if (best === undefined || best.confidence < policy.minConfidence) {
    return { status: 'unavailable', data: null, code: 'GEOCODE_LOW_CONFIDENCE' };
  }
  const runnerUp = ranked[1];
  if (runnerUp !== undefined && best.confidence - runnerUp.confidence < policy.minScoreGap - Number.EPSILON) {
    return { status: 'unavailable', data: null, code: 'GEOCODE_AMBIGUOUS' };
  }
  if (input.biasPosition !== undefined && distanceMeters(input.biasPosition, best) > policy.maxBiasDistanceMeters) {
    return { status: 'unavailable', data: null, code: 'GEOCODE_OUT_OF_AREA' };
  }
  return { status: 'ok', data: [best] };
}

export interface AmazonLocationGeocodeRequest {
  QueryText: string;
  BiasPosition?: [number, number];
  Language?: string;
  MaxResults: number;
  IntendedUse: 'SingleUse' | 'Storage';
}
export interface AmazonLocationGeocodingClient {
  geocode(input: AmazonLocationGeocodeRequest, signal: AbortSignal): Promise<unknown>;
}
export interface AmazonLocationGeocodingAdapterOptions {
  client: AmazonLocationGeocodingClient;
  timeoutMs: number;
  policy?: GeocodingPolicy;
}
export interface AmazonLocationGeocodingConfig {
  region: string;
  timeoutMs: number;
  policy?: GeocodingPolicy;
}

export class AmazonLocationGeocodingProvider implements GeocodingProvider {
  private readonly policy: GeocodingPolicy;

  constructor(private readonly options: AmazonLocationGeocodingAdapterOptions) {
    this.policy = PolicySchema.parse(options.policy ?? defaultGeocodingPolicy);
  }

  async geocode(input: GeocodingInput): Promise<ProviderResult<GeocodedPlace[]>> {
    const parsed = GeocodingInputSchema.safeParse(input);
    if (!parsed.success) return { status: 'error', data: null, code: 'INVALID_REQUEST' };
    const value = parsed.data;
    const request: AmazonLocationGeocodeRequest = {
      QueryText: value.queryText,
      MaxResults: 5,
      IntendedUse: value.persistenceIntent === 'storage' ? 'Storage' : 'SingleUse',
      ...(value.locale === undefined ? {} : { Language: value.locale }),
      ...(value.biasPosition === undefined ? {} : { BiasPosition: [value.biasPosition.longitude, value.biasPosition.latitude] })
    };
    const startedAt = performance.now();
    try {
      const response = await withTimeout(signal => this.options.client.geocode(request, signal), this.options.timeoutMs);
      const normalizedInput: GeocodingInput = {
        queryText: value.queryText, persistenceIntent: value.persistenceIntent,
        ...(value.biasPosition === undefined ? {} : { biasPosition: value.biasPosition }),
        ...(value.locale === undefined ? {} : { locale: value.locale })
      };
      return { ...normalizeGeocodingResults(response, normalizedInput, this.policy), latencyMs: elapsedSince(startedAt) };
    } catch (error: unknown) {
      const mapped = mapAwsError(error);
      return { status: mapped.status, data: null, code: mapped.code, latencyMs: elapsedSince(startedAt) };
    }
  }
}

export function createAmazonLocationGeocodingProvider(
  config: AmazonLocationGeocodingConfig,
  clientOverride?: AmazonLocationGeocodingClient
): AmazonLocationGeocodingProvider {
  const sdk = clientOverride === undefined ? new GeoPlacesClient({ region: config.region, maxAttempts: 1 }) : undefined;
  const client = clientOverride ?? {
    geocode: (input: AmazonLocationGeocodeRequest, signal: AbortSignal) => {
      const request: GeocodeCommandInput = input;
      return sdk!.send(new GeocodeCommand(request), { abortSignal: signal });
    }
  };
  return new AmazonLocationGeocodingProvider({
    client, timeoutMs: config.timeoutMs,
    ...(config.policy === undefined ? {} : { policy: config.policy })
  });
}
