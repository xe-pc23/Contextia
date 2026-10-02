import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { parseApiRuntimeConfig } from '@contextia/config';
import {
  createAmazonLocationGeocodingProvider, createAmazonLocationPlacesProvider, createAmazonLocationRouteProvider,
  createBedrockRecommendationModel,
  createDynamoDbStateRepository, createOpenMeteoWeatherProvider, createExpoNotificationProvider, createSnsNotificationProvider
} from '@contextia/providers';
import { createLambdaHandler } from './handler.js';
import type { HandlerOptions, RequestLog } from './handler.js';
import { createAccountServices } from './application/account.js';
import { createDeviceServices } from './application/devices.js';
import { createChatWithRecommendation } from './application/chatWithRecommendation.js';
import { createEvaluateContext, defaultEvaluationPolicy } from './application/evaluateContext.js';
import { createEvaluationDomain } from './composition/evaluationDomain.js';
import { createRemoteDelivery } from './application/remoteDelivery.js';
import { createServerPushEvaluation } from './application/serverPushEvaluation.js';
import { createMetrics } from './observability.js';
import type { GetPlaceInput, PlacesProvider } from '@contextia/providers';
import type { PersistenceIntent } from '@contextia/contracts';

export { createLambdaHandler, createRequestHandler } from './handler.js';

export function composeRuntime(env: Record<string, string | undefined>, log: (entry: RequestLog) => void): HandlerOptions {
  const config = parseApiRuntimeConfig(env);
  const metrics = createMetrics(config.stage, entry => { process.stdout.write(JSON.stringify(entry) + '\n'); });
  const state = createDynamoDbStateRepository({ region: config.region, tableName: config.tableName, timeoutMs: config.stateTimeoutMs });
  const places = createAmazonLocationPlacesProvider({ region: config.region, timeoutMs: config.placesTimeoutMs });
  const geocoding = createAmazonLocationGeocodingProvider({ region: config.region, timeoutMs: config.placesTimeoutMs });
  const routes = createAmazonLocationRouteProvider({ region: config.region, timeoutMs: config.routesTimeoutMs });
  const weather = createOpenMeteoWeatherProvider({ endpoint: config.weatherEndpoint, timeoutMs: config.weatherTimeoutMs });
  const model = createBedrockRecommendationModel({ region: config.modelRegion, modelId: config.modelId, timeoutMs: config.modelTimeoutMs, structuredOutput: config.structuredOutput,
    onAttempt: entry => metrics.record({ Provider: 'modelAttempt', Operation: entry.attempt, Status: entry.status, Count: 1, Errors: entry.status === 'ok' ? 0 : 1, Latency: entry.latencyMs }),
    onValidationFailure: () => metrics.record({ Provider: 'bedrock', Operation: 'validate', Status: 'error', Count: 1, Errors: 1, Latency: 0 }) });
  const observedPlaces: PlacesProvider = { searchNearby: input => metrics.provider('places', 'searchNearby', () => places.searchNearby(input)), getPlace: <I extends PersistenceIntent>(input: GetPlaceInput<I>) => metrics.provider('places', 'getPlace', () => places.getPlace(input)) };
  const observedModel = { decide: (input: Parameters<typeof model.decide>[0]) => metrics.provider('bedrock', 'decide', () => model.decide(input)), followUp: (input: Parameters<typeof model.followUp>[0]) => metrics.provider('bedrock', 'followUp', () => model.followUp(input)) };
  const sns = env.SNS_IOS_APPLICATION_ARN || env.SNS_ANDROID_APPLICATION_ARN ? createSnsNotificationProvider({ region: config.region, stage: config.stage, timeoutMs: 5000,
    applicationArns: { ...(env.SNS_IOS_APPLICATION_ARN ? { ios: env.SNS_IOS_APPLICATION_ARN } : {}), ...(env.SNS_ANDROID_APPLICATION_ARN ? { android: env.SNS_ANDROID_APPLICATION_ARN } : {}) } }) : undefined;
  const expo = createExpoNotificationProvider({ endpoint: env.EXPO_PUSH_ENDPOINT ?? 'https://exp.host/--/api/v2/push/send', timeoutMs: 5000, ...(env.EXPO_PUSH_ACCESS_TOKEN ? { accessToken: env.EXPO_PUSH_ACCESS_TOKEN } : {}) });
  if (env.REMOTE_PUSH_PROVIDER && !['expo', 'sns'].includes(env.REMOTE_PUSH_PROVIDER)) throw new Error('Invalid remote push provider');
  const clock = () => new Date();
  const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
  const policy = { ...defaultEvaluationPolicy,
    placesTimeoutMs: config.placesTimeoutMs, weatherTimeoutMs: config.weatherTimeoutMs,
    routesTimeoutMs: config.routesTimeoutMs, modelTimeoutMs: config.modelTimeoutMs,
    enrichmentTimeoutMs: config.enrichmentTimeoutMs, maxRoutePlaces: config.maxRoutePlaces,
    evaluationTimeoutMs: config.evaluationTimeoutMs,
    routeConcurrency: config.routeConcurrency, eventRouteMode: config.eventRouteMode,
    contextTtlSeconds: config.contextTtlSeconds, recommendationTtlSeconds: config.recommendationTtlSeconds,
    idempotencyTtlSeconds: config.idempotencyTtlSeconds
  };
  const evaluate = createEvaluateContext({ state, idempotency: state, places: observedPlaces,
    geocoding: { geocode: input => metrics.provider('geocoding', 'geocode', () => geocoding.geocode(input)) },
    routes: { getRoute: input => metrics.provider('routes', 'getRoute', () => routes.getRoute(input)) },
    weather: { getWeather: input => metrics.provider('weather', 'getWeather', () => weather.getWeather(input)) }, model: observedModel,
    domain: createEvaluationDomain(), clock, newId, policy });
  const dispatch = createRemoteDelivery({ state, providers: { expo, ...(sns ? { sns } : {}) }, provider: env.REMOTE_PUSH_PROVIDER === 'sns' ? 'sns' : 'expo', clock, newClaimId: () => randomUUID() });
  const observedEvaluate: typeof evaluate = async input => {
    const started = performance.now(); let status: 'ok' | 'error' = 'error';
    try { const result = await evaluate(input); status = 'ok'; metrics.decision(result); return result; }
    finally { metrics.record({ Provider: 'evaluation', Operation: 'evaluate', Status: status, Count: 1, Errors: status === 'ok' ? 0 : 1, Latency: Math.round(performance.now() - started) }); }
  };
  return {
    version: env.BUILD_ID ?? 'development', stage: config.stage, log,
    clients: { webClientId: env.WEB_CLIENT_ID ?? null, mobileClientId: env.MOBILE_CLIENT_ID ?? null },
    account: createAccountServices(state, clock),
    devices: createDeviceServices(state, clock, sns),
    serverPush: createServerPushEvaluation(observedEvaluate, dispatch),
    chat: createChatWithRecommendation({ state, places: observedPlaces, model: observedModel, clock, newId, modelTimeoutMs: config.modelTimeoutMs,
      placesTimeoutMs: config.placesTimeoutMs, conversationTtlSeconds: config.conversationTtlSeconds }),
    evaluate: observedEvaluate
  };
}

type Event = APIGatewayProxyEventV2 | APIGatewayProxyEventV2WithJWTAuthorizer;
export function createRuntimeHandler(env: Record<string, string | undefined>, log: (entry: RequestLog) => void,
  compose: typeof composeRuntime = composeRuntime) {
  let composed: ReturnType<typeof createLambdaHandler> | undefined;
  const execute = async (event: Event) => {
    // Health must work without credentials/configuration and never contacts providers.
    if (event.rawPath === '/health' && event.requestContext.http.method === 'GET') {
      return createLambdaHandler({ version: env.BUILD_ID ?? 'development', log })(event);
    }
    if (!composed) {
      try { composed = createLambdaHandler(compose(env, log)); }
      catch {
        log({ event: 'http_request', requestId: event.requestContext.requestId, route: 'not-found', statusCode: 503, errorCode: 'CONFIGURATION_UNAVAILABLE' });
        return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
          body: JSON.stringify({ requestId: event.requestContext.requestId, error: { code: 'CONFIGURATION_UNAVAILABLE', message: 'API configuration is unavailable.' } }) };
      }
    }
    return composed(event);
  };
  const metrics = createMetrics(env.CONTEXTIA_STAGE === 'prod' ? 'prod' : 'dev', entry => { process.stdout.write(JSON.stringify(entry) + '\n'); });
  return async (event: Event) => {
    const started = performance.now(); let status: 'ok' | 'error' = 'error';
    try { const result = await execute(event); status = result.statusCode < 400 ? 'ok' : 'error'; return result; }
    finally { metrics.record({ Provider: 'http', Operation: 'request', Status: status, Count: 1, Errors: status === 'ok' ? 0 : 1, Latency: Math.round(performance.now() - started) }); }
  };
}

export const handler = createRuntimeHandler(process.env, entry => { console.log(JSON.stringify(entry)); });
