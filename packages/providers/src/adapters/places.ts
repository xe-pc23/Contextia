import {
  GetPlaceCommand,
  GeoPlacesClient,
  SearchNearbyCommand
} from '@aws-sdk/client-geo-places';
import type {
  GetPlaceCommandInput,
  SearchNearbyCommandInput
} from '@aws-sdk/client-geo-places';
import { GeoPointSchema, ProviderPlaceSchema } from '@contextia/contracts';
import type { PersistenceIntent, ProviderPlace, ProviderResult } from '@contextia/contracts';
import { z } from 'zod';
import type { GetPlaceInput, NearbyPlacesInput, PlaceWithIntent, PlacesProvider } from '../ports/PlacesProvider.js';
import { AdapterTimeoutError, available, elapsedSince, mapAwsError, unavailable, withTimeout } from './shared.js';

const NearbyInputSchema = z.strictObject({
  position: GeoPointSchema,
  radiusMeters: z.number().int().min(1).max(21_000_000),
  locale: z.string().min(2).max(35).optional(),
  maxResults: z.number().int().min(1).optional(),
  persistenceIntent: z.enum(['single-use', 'storage'])
});
const GetPlaceInputSchema = z.strictObject({
  placeId: z.string().min(1).max(500),
  locale: z.string().min(2).max(35).optional(),
  persistenceIntent: z.enum(['single-use', 'storage'])
});
const NearbyResponseSchema = z.object({ ResultItems: z.array(z.unknown()) }).passthrough();
const CategorySchema = z.object({ Name: z.string().optional(), LocalizedName: z.string().optional() }).passthrough();
const PlaceResponseSchema = z.object({
  PlaceId: z.string().min(1),
  Title: z.string().min(1),
  Position: z.tuple([z.number().finite(), z.number().finite()]),
  Distance: z.number().nonnegative().optional(),
  Categories: z.array(CategorySchema).optional(),
  OpeningHours: z.array(z.object({ OpenNow: z.boolean().optional() }).passthrough()).optional(),
  Contacts: z.object({ Websites: z.array(z.object({ Value: z.string() }).passthrough()).optional() }).passthrough().optional()
}).passthrough();

export interface AmazonLocationPlacesClient {
  searchNearby(input: AmazonLocationSearchNearbyRequest, signal: AbortSignal): Promise<unknown>;
  getPlace(input: AmazonLocationGetPlaceRequest, signal: AbortSignal): Promise<unknown>;
}

export interface AmazonLocationSearchNearbyRequest {
  QueryPosition: [number, number];
  QueryRadius: number;
  MaxResults: number;
  IntendedUse: 'SingleUse' | 'Storage';
  Language?: string;
}

export interface AmazonLocationGetPlaceRequest {
  PlaceId: string;
  IntendedUse: 'SingleUse' | 'Storage';
  Language?: string;
}

export interface AmazonLocationPlacesAdapterOptions {
  client: AmazonLocationPlacesClient;
  timeoutMs: number;
}

export interface AmazonLocationPlacesConfig {
  region: string;
  timeoutMs: number;
}

function toAwsIntent(intent: PersistenceIntent): 'SingleUse' | 'Storage' {
  return intent === 'storage' ? 'Storage' : 'SingleUse';
}

function normalizePlace(input: unknown): ProviderPlace | null {
  const parsed = PlaceResponseSchema.safeParse(input);
  if (!parsed.success) return null;
  const [longitude, latitude] = parsed.data.Position;
  const categoryNames = parsed.data.Categories
    ?.map(category => category.LocalizedName?.trim() || category.Name?.trim())
    .filter((name): name is string => name !== undefined && name.length > 0);
  const openingNow = parsed.data.OpeningHours?.find(hours => typeof hours.OpenNow === 'boolean')?.OpenNow;
  const websiteUrl = parsed.data.Contacts?.Websites
    ?.map(website => website.Value)
    .find(value => /^https?:\/\//i.test(value));
  const draft: Record<string, unknown> = {
    provider: 'amazon-location',
    placeId: parsed.data.PlaceId,
    name: parsed.data.Title,
    latitude,
    longitude
  };
  if (parsed.data.Distance !== undefined) draft.distanceMeters = parsed.data.Distance;
  if (categoryNames !== undefined && categoryNames.length > 0) draft.categoryNames = categoryNames;
  if (openingNow !== undefined) draft.isOpen = openingNow;
  if (websiteUrl !== undefined) draft.websiteUrl = websiteUrl;
  const normalized = ProviderPlaceSchema.safeParse(draft);
  return normalized.success ? normalized.data : null;
}

function invalidRequest<T>(): ProviderResult<T> {
  return { status: 'error', data: null, code: 'INVALID_REQUEST' };
}

function sdkBackedClient(client: GeoPlacesClient): AmazonLocationPlacesClient {
  return {
    searchNearby: (input, signal) => {
      const sdkInput: SearchNearbyCommandInput = {
        QueryPosition: input.QueryPosition,
        QueryRadius: input.QueryRadius,
        MaxResults: input.MaxResults,
        IntendedUse: input.IntendedUse,
        ...(input.Language === undefined ? {} : { Language: input.Language })
      };
      return client.send(new SearchNearbyCommand(sdkInput), { abortSignal: signal });
    },
    getPlace: (input, signal) => {
      const sdkInput: GetPlaceCommandInput = {
        PlaceId: input.PlaceId,
        IntendedUse: input.IntendedUse,
        ...(input.Language === undefined ? {} : { Language: input.Language })
      };
      return client.send(new GetPlaceCommand(sdkInput), { abortSignal: signal });
    }
  };
}

export class AmazonLocationPlacesProvider implements PlacesProvider {
  private readonly client: AmazonLocationPlacesClient;
  private readonly timeoutMs: number;

  constructor(options: AmazonLocationPlacesAdapterOptions) {
    this.client = options.client;
    this.timeoutMs = options.timeoutMs;
  }

  async searchNearby(input: NearbyPlacesInput): Promise<ProviderResult<ProviderPlace[]>> {
    const parsedInput = NearbyInputSchema.safeParse(input);
    if (!parsedInput.success) return invalidRequest();
    const value = parsedInput.data;
    const request: AmazonLocationSearchNearbyRequest = {
      QueryPosition: [value.position.longitude, value.position.latitude],
      QueryRadius: value.radiusMeters,
      MaxResults: Math.min(value.maxResults ?? 30, 30),
      IntendedUse: toAwsIntent(value.persistenceIntent),
      ...(value.locale === undefined ? {} : { Language: value.locale })
    };
    const startedAt = performance.now();
    try {
      const response = await withTimeout(signal => this.client.searchNearby(request, signal), this.timeoutMs);
      const parsedResponse = NearbyResponseSchema.safeParse(response);
      if (!parsedResponse.success) return unavailable('error', elapsedSince(startedAt), 'INVALID_RESPONSE');
      const places: ProviderPlace[] = [];
      let invalidCount = 0;
      for (const item of parsedResponse.data.ResultItems) {
        const place = normalizePlace(item);
        if (place === null) invalidCount += 1;
        else places.push(place);
      }
      if (invalidCount > 0 && places.length === 0) return unavailable('error', elapsedSince(startedAt), 'INVALID_RESPONSE');
      return invalidCount > 0
        ? available('degraded', places, elapsedSince(startedAt), 'INVALID_ITEMS')
        : available('ok', places, elapsedSince(startedAt));
    } catch (error: unknown) {
      const mapped = error instanceof AdapterTimeoutError ? { status: 'timeout' as const, code: 'TIMEOUT' } : mapAwsError(error);
      return unavailable(mapped.status, elapsedSince(startedAt), mapped.code);
    }
  }

  async getPlace<I extends PersistenceIntent>(input: GetPlaceInput<I>): Promise<ProviderResult<PlaceWithIntent<I>>> {
    const parsedInput = GetPlaceInputSchema.safeParse(input);
    if (!parsedInput.success) return invalidRequest();
    const value = parsedInput.data;
    const request: AmazonLocationGetPlaceRequest = {
      PlaceId: value.placeId,
      IntendedUse: toAwsIntent(value.persistenceIntent),
      ...(value.locale === undefined ? {} : { Language: value.locale })
    };
    const startedAt = performance.now();
    try {
      const response = await withTimeout(signal => this.client.getPlace(request, signal), this.timeoutMs);
      const place = normalizePlace(response);
      if (place === null) return unavailable('error', elapsedSince(startedAt), 'INVALID_RESPONSE');
      if (place.placeId !== value.placeId) return unavailable('error', elapsedSince(startedAt), 'PLACE_ID_MISMATCH');
      const data: PlaceWithIntent<I> = { persistenceIntent: value.persistenceIntent as I, place };
      return available('ok', data, elapsedSince(startedAt));
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'ResourceNotFoundException' || name === 'PlaceNotFoundException') {
        return { status: 'unavailable', data: null, latencyMs: elapsedSince(startedAt), code: 'PLACE_NOT_FOUND' };
      }
      const mapped = error instanceof AdapterTimeoutError ? { status: 'timeout' as const, code: 'TIMEOUT' } : mapAwsError(error);
      return unavailable(mapped.status, elapsedSince(startedAt), mapped.code);
    }
  }
}

export function createAmazonLocationPlacesProvider(
  config: AmazonLocationPlacesConfig,
  clientOverride?: AmazonLocationPlacesClient
): AmazonLocationPlacesProvider {
  const client = clientOverride ?? sdkBackedClient(new GeoPlacesClient({ region: config.region, maxAttempts: 2 }));
  return new AmazonLocationPlacesProvider({ client, timeoutMs: config.timeoutMs });
}
