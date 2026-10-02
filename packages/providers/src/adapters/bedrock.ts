import {
  BedrockRuntimeClient,
  ConverseCommand
} from '@aws-sdk/client-bedrock-runtime';
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import {
  RecommendationDecisionSchema
} from '@contextia/contracts';
import type {
  ProviderPlace,
  ProviderResult,
  RecommendationDecision,
  RecommendationItem,
  RouteSummary
} from '@contextia/contracts';
import { z } from 'zod';
import type {
  ProviderEnrichment,
  RecommendationFollowUpInput,
  RecommendationModel,
  RecommendationModelInput
} from '../ports/RecommendationModel.js';
import { AdapterTimeoutError, available, elapsedSince, errorName, mapAwsError, unavailable, withTimeout } from './shared.js';

const ConverseResponseSchema = z.object({
  output: z.object({
    message: z.object({
      content: z.array(z.object({ text: z.string().optional() }).passthrough())
    }).passthrough()
  }).passthrough()
}).passthrough();

const SYSTEM_PROMPT = [
  'You are Contextia, a concise contextual recommendation assistant.',
  'Use only facts in the supplied candidates and provider results. Never invent places, route details, or provider facts.',
  'Return only the requested decision object. Do not provide internal reasoning; give concise, user-facing reasons.'
].join(' ');

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'maximum', 'maxItems', 'maxLength', 'minimum', 'minLength', 'multipleOf', 'pattern', 'prefixItems'
]);

export interface BedrockConverseClient {
  converse(input: BedrockConverseRequest, signal: AbortSignal): Promise<unknown>;
}

export interface BedrockConverseRequest {
  modelId: string;
  system: { text: string }[];
  messages: { role: 'user'; content: { text: string }[] }[];
  inferenceConfig: { maxTokens: number; temperature: number };
  outputConfig?: {
    textFormat: {
      type: 'json_schema';
      structure: { jsonSchema: { name: string; description: string; schema: string } };
    };
  };
}

export interface BedrockRecommendationAdapterOptions {
  client: BedrockConverseClient;
  modelId: string;
  timeoutMs: number;
  structuredOutput?: boolean;
}

export interface BedrockRecommendationConfig {
  region: string;
  modelId: string;
  timeoutMs: number;
  structuredOutput?: boolean;
}

function sdkBackedClient(client: BedrockRuntimeClient): BedrockConverseClient {
  return {
    converse: (input, signal) => {
      const sdkInput: ConverseCommandInput = {
        modelId: input.modelId,
        system: input.system,
        messages: input.messages,
        inferenceConfig: input.inferenceConfig,
        ...(input.outputConfig === undefined ? {} : { outputConfig: input.outputConfig })
      };
      return client.send(new ConverseCommand(sdkInput), { abortSignal: signal });
    }
  };
}

function outputSchema(): string {
  return JSON.stringify(toBedrockSchema(z.toJSONSchema(RecommendationDecisionSchema)));
}

function toBedrockSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toBedrockSchema);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'array' && record.items === false
    && Array.isArray(record.prefixItems) && record.prefixItems.length === 0) {
    return { const: [] };
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    normalized[key === 'oneOf' ? 'anyOf' : key] = toBedrockSchema(child);
  }
  return normalized;
}

function modelPayload(input: RecommendationModelInput): Record<string, unknown> {
  return {
    now: input.now,
    context: input.context,
    preferences: input.preferences,
    candidates: input.candidates,
    providerResults: {
      geocoding: input.enrichment.geocoding,
      places: input.enrichment.places,
      weather: input.enrichment.weather,
      routes: input.enrichment.routes
    },
    recentRecommendations: input.recentRecommendations
  };
}

function requestFor(
  modelId: string,
  input: RecommendationModelInput,
  structuredOutput: boolean,
  isRepair: boolean
): BedrockConverseRequest {
  const instructions = isRepair
    ? 'Generate a fresh decision. The prior result failed schema or supplied-reference validation. Follow the schema and use only facts in this request.'
    : 'Evaluate the candidates and return a decision that follows the schema.';
  const request: BedrockConverseRequest = {
    modelId,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: `${instructions}\n${JSON.stringify(modelPayload(input))}` }] }],
    inferenceConfig: { maxTokens: 1200, temperature: 0.2 }
  };
  if (structuredOutput) {
    request.outputConfig = {
      textFormat: {
        type: 'json_schema',
        structure: {
          jsonSchema: {
            name: 'recommendation_decision',
            description: 'A Contextia recommendation decision',
            schema: outputSchema()
          }
        }
      }
    };
  }
  return request;
}

function candidatePlaces(enrichment: ProviderEnrichment): ProviderPlace[] {
  return enrichment.places.flatMap(({ result }) =>
    result.status === 'ok' || result.status === 'degraded' ? result.data : []
  );
}

function candidateRoutes(enrichment: ProviderEnrichment): RouteSummary[] {
  return enrichment.routes.flatMap(({ result }) =>
    result.status === 'ok' || result.status === 'degraded' ? [result.data] : []
  );
}

function matchesPlace(recommendationPlace: NonNullable<RecommendationItem['place']>, place: ProviderPlace): boolean {
  return recommendationPlace.provider === place.provider
    && recommendationPlace.placeId === place.placeId
    && recommendationPlace.name === place.name
    && recommendationPlace.latitude === place.latitude
    && recommendationPlace.longitude === place.longitude
    && (recommendationPlace.distanceMeters === undefined || recommendationPlace.distanceMeters === place.distanceMeters);
}

function matchesRoute(recommendationRoute: NonNullable<RecommendationItem['route']>, route: RouteSummary): boolean {
  return recommendationRoute.mode === route.mode
    && recommendationRoute.durationMinutes === route.durationMinutes
    && (recommendationRoute.departAt === undefined || recommendationRoute.departAt === route.departAt)
    && (recommendationRoute.arriveAt === undefined || recommendationRoute.arriveAt === route.arriveAt)
    && (recommendationRoute.transfers === undefined || recommendationRoute.transfers === route.transfers);
}

function usesOnlySuppliedReferences(decision: RecommendationDecision, enrichment: ProviderEnrichment): boolean {
  if (decision.decision === 'silent') return true;
  const places = candidatePlaces(enrichment);
  const routes = candidateRoutes(enrichment);
  return decision.recommendations.every(item => {
    const placeIsSupplied = item.place == null || places.some(place => matchesPlace(item.place!, place));
    const routeIsSupplied = item.route == null || routes.some(route => matchesRoute(item.route!, route));
    return placeIsSupplied && routeIsSupplied;
  });
}

function parseDecision(response: unknown, enrichment: ProviderEnrichment): RecommendationDecision | null {
  const parsedResponse = ConverseResponseSchema.safeParse(response);
  if (!parsedResponse.success) return null;
  const content = parsedResponse.data.output.message.content
    .map(block => block.text)
    .filter((text): text is string => text !== undefined)
    .join('\n');
  if (content.length === 0) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  const parsedDecision = RecommendationDecisionSchema.safeParse(decoded);
  if (!parsedDecision.success || !usesOnlySuppliedReferences(parsedDecision.data, enrichment)) return null;
  return parsedDecision.data;
}

function invalidOutput<T>(latencyMs: number): ProviderResult<T> {
  return unavailable('error', latencyMs, 'INVALID_MODEL_OUTPUT');
}

function mapBedrockFailure<T>(error: unknown, latencyMs: number): ProviderResult<T> {
  const mapped = error instanceof AdapterTimeoutError
    ? { status: 'timeout' as const, code: 'TIMEOUT' }
    : mapAwsError(error);
  return unavailable(mapped.status, latencyMs, mapped.code);
}

function isStructuredOutputUnsupported(error: unknown): boolean {
  if (errorName(error) !== 'ValidationException') return false;
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  return /schema|structured output|output.?config|json/i.test(message);
}

export class BedrockRecommendationModel implements RecommendationModel {
  private readonly client: BedrockConverseClient;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly structuredOutput: boolean;

  constructor(options: BedrockRecommendationAdapterOptions) {
    this.client = options.client;
    this.modelId = options.modelId;
    this.timeoutMs = options.timeoutMs;
    this.structuredOutput = options.structuredOutput ?? true;
  }

  async decide(input: RecommendationModelInput): Promise<ProviderResult<RecommendationDecision>> {
    if (input.candidates.length === 0) return { status: 'not_requested', data: null };
    const startedAt = performance.now();
    const remainingTimeoutMs = () => this.timeoutMs - (performance.now() - startedAt);
    const timeoutResult = (): ProviderResult<RecommendationDecision> =>
      unavailable<RecommendationDecision>('timeout', elapsedSince(startedAt), 'TIMEOUT');
    let useStructuredOutput = this.structuredOutput;
    let decision: RecommendationDecision | null;
    let firstResponse: unknown;
    try {
      firstResponse = await withTimeout(
        signal => this.client.converse(requestFor(this.modelId, input, useStructuredOutput, false), signal),
        this.timeoutMs
      );
    } catch (error: unknown) {
      if (!useStructuredOutput || !isStructuredOutputUnsupported(error)) {
        return mapBedrockFailure(error, elapsedSince(startedAt));
      }
      useStructuredOutput = false;
      const remaining = remainingTimeoutMs();
      if (remaining <= 0) return timeoutResult();
      try {
        firstResponse = await withTimeout(
          signal => this.client.converse(requestFor(this.modelId, input, false, false), signal),
          remaining
        );
      } catch (fallbackError: unknown) {
        return mapBedrockFailure(fallbackError, elapsedSince(startedAt));
      }
    }
    decision = parseDecision(firstResponse, input.enrichment);
    if (decision !== null) return available('ok', decision, elapsedSince(startedAt));

    const remaining = remainingTimeoutMs();
    if (remaining <= 0) return timeoutResult();
    try {
      const repairedResponse = await withTimeout(
        signal => this.client.converse(requestFor(this.modelId, input, useStructuredOutput, true), signal),
        remaining
      );
      decision = parseDecision(repairedResponse, input.enrichment);
    } catch (error: unknown) {
      return mapBedrockFailure(error, elapsedSince(startedAt));
    }
    return decision === null
      ? invalidOutput(elapsedSince(startedAt))
      : available('degraded', decision, elapsedSince(startedAt), 'REPAIRED_OUTPUT');
  }

  async followUp(input: RecommendationFollowUpInput): Promise<ProviderResult<never>> {
    void input;
    return unavailable('error', 0, 'NOT_IMPLEMENTED');
  }
}

export function createBedrockRecommendationModel(
  config: BedrockRecommendationConfig,
  clientOverride?: BedrockConverseClient
): BedrockRecommendationModel {
  const client = clientOverride ?? sdkBackedClient(new BedrockRuntimeClient({ region: config.region, maxAttempts: 1 }));
  return new BedrockRecommendationModel({
    client,
    modelId: config.modelId,
    timeoutMs: config.timeoutMs,
    ...(config.structuredOutput === undefined ? {} : { structuredOutput: config.structuredOutput })
  });
}
