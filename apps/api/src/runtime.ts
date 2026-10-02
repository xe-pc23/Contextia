import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { parseApiRuntimeConfig } from '@contextia/config';
import {
  createAmazonLocationGeocodingProvider, createAmazonLocationPlacesProvider, createAmazonLocationRouteProvider,
  createBedrockRecommendationModel,
  createDynamoDbStateRepository, createOpenMeteoWeatherProvider
} from '@contextia/providers';
import { createLambdaHandler } from './handler.js';
import type { HandlerOptions, RequestLog } from './handler.js';
import { createAccountServices } from './application/account.js';
import { createChatWithRecommendation } from './application/chatWithRecommendation.js';
import { createEvaluateContext, defaultEvaluationPolicy } from './application/evaluateContext.js';
import { createEvaluationDomain } from './composition/evaluationDomain.js';

export { createLambdaHandler, createRequestHandler } from './handler.js';

export function composeRuntime(env: Record<string, string | undefined>, log: (entry: RequestLog) => void): HandlerOptions {
  const config = parseApiRuntimeConfig(env);
  const state = createDynamoDbStateRepository({ region: config.region, tableName: config.tableName, timeoutMs: config.stateTimeoutMs });
  const places = createAmazonLocationPlacesProvider({ region: config.region, timeoutMs: config.placesTimeoutMs });
  const geocoding = createAmazonLocationGeocodingProvider({ region: config.region, timeoutMs: config.placesTimeoutMs });
  const routes = createAmazonLocationRouteProvider({ region: config.region, timeoutMs: config.routesTimeoutMs });
  const weather = createOpenMeteoWeatherProvider({ endpoint: config.weatherEndpoint, timeoutMs: config.weatherTimeoutMs });
  const model = createBedrockRecommendationModel({ region: config.modelRegion, modelId: config.modelId, timeoutMs: config.modelTimeoutMs, structuredOutput: config.structuredOutput });
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
  return {
    version: env.BUILD_ID ?? 'development', log,
    clients: { webClientId: env.WEB_CLIENT_ID ?? null, mobileClientId: env.MOBILE_CLIENT_ID ?? null },
    account: createAccountServices(state, clock),
    chat: createChatWithRecommendation({ state, places, model, clock, newId, modelTimeoutMs: config.modelTimeoutMs,
      placesTimeoutMs: config.placesTimeoutMs, conversationTtlSeconds: config.conversationTtlSeconds }),
    evaluate: createEvaluateContext({ state, idempotency: state, places, geocoding, routes, weather, model,
      domain: createEvaluationDomain(), clock, newId, policy })
  };
}

type Event = APIGatewayProxyEventV2 | APIGatewayProxyEventV2WithJWTAuthorizer;
export function createRuntimeHandler(env: Record<string, string | undefined>, log: (entry: RequestLog) => void,
  compose: typeof composeRuntime = composeRuntime) {
  let composed: ReturnType<typeof createLambdaHandler> | undefined;
  return async (event: Event) => {
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
}

export const handler = createRuntimeHandler(process.env, entry => { console.log(JSON.stringify(entry)); });
