import { z } from 'zod';

// Approved deployment boundary; changing it requires an environment decision.
export const EXPECTED_AWS_ACCOUNT = '634512763705';
export const EXPECTED_AWS_REGION = 'ap-northeast-1';

export const DeploymentConfigSchema = z.strictObject({
  stage: z.enum(['dev', 'prod']),
  account: z.literal(EXPECTED_AWS_ACCOUNT),
  region: z.literal(EXPECTED_AWS_REGION),
  buildId: z.string().trim().min(1).max(128).default('development')
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

export function parseDeploymentConfig(input: unknown): DeploymentConfig {
  return DeploymentConfigSchema.parse(input);
}

const positive = (fallback: number) => z.coerce.number().int().positive().default(fallback);
export const ApiRuntimeConfigSchema = z.strictObject({
  stage: z.enum(['dev', 'prod']),
  region: z.literal(EXPECTED_AWS_REGION),
  tableName: z.string().min(1),
  modelRegion: z.string().min(1),
  modelId: z.string().trim().min(1),
  structuredOutput: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  weatherEndpoint: z.url().refine(value => new URL(value).protocol === 'https:').default('https://api.open-meteo.com/v1/forecast'),
  stateTimeoutMs: positive(1500),
  placesTimeoutMs: positive(2500),
  weatherTimeoutMs: positive(2000),
  routesTimeoutMs: positive(3000),
  modelTimeoutMs: positive(7000),
  enrichmentTimeoutMs: positive(7000),
  evaluationTimeoutMs: positive(20000).pipe(z.number().max(20000)),
  maxRoutePlaces: positive(6).pipe(z.number().max(30)),
  routeConcurrency: positive(4).pipe(z.number().max(8)),
  eventRouteMode: z.enum(['transit', 'intermodal']).default('transit'),
  contextTtlSeconds: positive(86400).pipe(z.number().max(86400)),
  recommendationTtlSeconds: positive(604800).pipe(z.number().max(604800)),
  conversationTtlSeconds: positive(7200).pipe(z.number().max(7200)),
  idempotencyTtlSeconds: positive(3600).pipe(z.number().max(3600))
}).refine(value => value.tableName === `contextia-${value.stage}-data`, { message: 'Table must belong to the selected stage', path: ['tableName'] });
export type ApiRuntimeConfig = z.infer<typeof ApiRuntimeConfigSchema>;

export function parseApiRuntimeConfig(env: Record<string, string | undefined>): ApiRuntimeConfig {
  return ApiRuntimeConfigSchema.parse({
    stage: env.CONTEXTIA_STAGE, region: env.AWS_REGION, tableName: env.TABLE_NAME,
    modelRegion: env.BEDROCK_REGION ?? env.AWS_REGION, modelId: env.BEDROCK_MODEL_ID,
    structuredOutput: env.BEDROCK_STRUCTURED_OUTPUT, weatherEndpoint: env.WEATHER_ENDPOINT,
    stateTimeoutMs: env.STATE_TIMEOUT_MS, placesTimeoutMs: env.PLACES_TIMEOUT_MS,
    weatherTimeoutMs: env.WEATHER_TIMEOUT_MS, routesTimeoutMs: env.ROUTES_TIMEOUT_MS,
    modelTimeoutMs: env.MODEL_TIMEOUT_MS, enrichmentTimeoutMs: env.ENRICHMENT_TIMEOUT_MS,
    evaluationTimeoutMs: env.EVALUATION_TIMEOUT_MS,
    maxRoutePlaces: env.MAX_ROUTE_PLACES, routeConcurrency: env.ROUTE_CONCURRENCY,
    eventRouteMode: env.EVENT_ROUTE_MODE, contextTtlSeconds: env.CONTEXT_TTL_SECONDS,
    recommendationTtlSeconds: env.RECOMMENDATION_TTL_SECONDS,
    conversationTtlSeconds: env.CONVERSATION_TTL_SECONDS, idempotencyTtlSeconds: env.IDEMPOTENCY_TTL_SECONDS
  });
}
