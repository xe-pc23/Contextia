import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { z } from 'zod';
import {
  ChatRequestSchema, ChatResponseSchema, ContextEvaluateRequestSchema, ContextEvaluateResponseSchema,
  EvaluationHeadersSchema, GetMeResponseSchema, GetRecommendationResponseSchema, ListRecommendationsResponseSchema,
  RecommendationParamsSchema, RecommendationsQuerySchema, UpdatePreferencesRequestSchema, UpdatePreferencesResponseSchema
} from '@contextia/contracts';
import type { ContextEvaluateRequest, ContextEvaluateResponse, ErrorResponse, HealthResponse } from '@contextia/contracts';
import { EvaluationFailure } from './application/evaluateContext.js';
import type { EvaluateContext } from './application/evaluateContext.js';
import { ApiFailure } from './application/apiFailure.js';
import type { AccountServices } from './application/account.js';
import type { ChatWithRecommendation } from './application/chatWithRecommendation.js';

export const MAX_BODY_BYTES = 256 * 1024;

export type RouteName = 'health' | 'evaluate' | 'me' | 'preferences' | 'recommendations' | 'recommendation' | 'chat' | 'not-found';

export type RequestLog = {
  event: 'http_request';
  requestId: string;
  route: RouteName;
  statusCode: number;
  mode?: ContextEvaluateRequest['mode'];
  errorCode?: string;
};

export type ApiResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

/** Cognito app clients allowed to request each evaluation mode. Missing IDs fail closed. */
export type ClientConfig = { webClientId: string | null; mobileClientId: string | null };

export type HandlerOptions = {
  version: string;
  log: (entry: RequestLog) => void;
  clients?: ClientConfig;
  /** Absent until provider adapters are composed; the route then reports 503 instead of fabricating results. */
  evaluate?: EvaluateContext;
  account?: AccountServices;
  chat?: ChatWithRecommendation;
};

/** Verified access-token claims supplied by the API Gateway JWT authorizer. */
export type AuthClaims = { sub: string; clientId: string };

export type ApiRequest = {
  method: string; path: string; requestId: string; body?: string | null; claims?: AuthClaims | null;
  query?: Record<string, string | undefined>; idempotencyKey?: string;
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(statusCode: number, body: unknown): ApiResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

type Outcome = { response: ApiResponse; mode?: ContextEvaluateRequest['mode']; errorCode?: string };

function error(statusCode: number, requestId: string, code: string, message: string, details?: { path: string; message: string }[]): Outcome {
  const body: ErrorResponse = { requestId, error: { code, message, ...(details ? { details } : {}) } };
  return { response: json(statusCode, body), errorCode: code };
}

function parseBody(body: string | null | undefined): { ok: true; value: unknown } | { ok: false; tooLarge: boolean } {
  if (!body) return { ok: false, tooLarge: false };
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

async function evaluate(request: ApiRequest, clients: ClientConfig, evaluateContext: EvaluateContext | undefined): Promise<Outcome> {
  const { requestId } = request;
  if (!request.claims) return error(401, requestId, 'UNAUTHORIZED', 'A valid access token is required.');
  const body = parseBody(request.body);
  if (!body.ok) {
    return body.tooLarge
      ? error(413, requestId, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
      : error(400, requestId, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }
  const parsed = ContextEvaluateRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 20).map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message }));
    return error(400, requestId, 'VALIDATION_ERROR', 'Request body is invalid.', details);
  }
  const mode = parsed.data.mode;
  const headers = EvaluationHeadersSchema.safeParse(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey });
  if (!headers.success) return { ...error(400, requestId, 'VALIDATION_ERROR', 'Idempotency-Key must be a UUID.'), mode };
  // Preview is limited to the Scenario Console client; proactive delivery to the mobile client.
  const allowedClient = mode === 'simulation' ? clients.webClientId : clients.mobileClientId;
  if (!allowedClient || request.claims.clientId !== allowedClient) {
    return { ...error(403, requestId, 'FORBIDDEN', 'This client is not allowed to request this evaluation mode.'), mode };
  }
  if (!evaluateContext) return { ...error(503, requestId, 'EVALUATION_UNAVAILABLE', 'Context evaluation is not available yet.'), mode };
  try {
    const data = await evaluateContext({ userId: request.claims.sub, context: parsed.data,
      ...(headers.data.idempotencyKey === undefined ? {} : { idempotencyKey: headers.data.idempotencyKey }) });
    return { response: json(200, ContextEvaluateResponseSchema.parse({ requestId, data } satisfies ContextEvaluateResponse)), mode };
  } catch (cause) {
    if (cause instanceof ApiFailure) return { ...apiFailure(cause, requestId), mode };
    if (cause instanceof EvaluationFailure) {
      return cause.code === 'PROFILE_NOT_FOUND'
        ? { ...error(404, requestId, 'PROFILE_NOT_FOUND', 'No profile exists for this user.'), mode }
        : { ...error(503, requestId, 'STATE_UNAVAILABLE', 'User state is temporarily unavailable.'), mode };
    }
    // Never echo internal error messages; the request ID correlates with the structured log.
    return { ...error(500, requestId, 'INTERNAL_ERROR', 'Context evaluation failed.'), mode };
  }
}

function apiFailure(cause: ApiFailure, requestId: string): Outcome {
  const mapping: Record<ApiFailure['code'], { status: number; message: string }> = {
    PROFILE_NOT_FOUND: { status: 404, message: 'No profile exists for this user.' },
    RECOMMENDATION_NOT_FOUND: { status: 404, message: 'Recommendation not found.' },
    STATE_UNAVAILABLE: { status: 503, message: 'User state is temporarily unavailable.' },
    MODEL_UNAVAILABLE: { status: 503, message: 'Recommendation chat is temporarily unavailable.' },
    INVALID_MODEL_OUTPUT: { status: 502, message: 'The recommendation model returned an unusable reply.' },
    INVALID_CURSOR: { status: 400, message: 'Pagination cursor is invalid.' },
    CHAT_LIMIT_REACHED: { status: 429, message: 'This conversation has reached its message limit.' },
    IDEMPOTENCY_CONFLICT: { status: 409, message: 'This idempotency key belongs to a different request.' },
    IDEMPOTENCY_IN_PROGRESS: { status: 409, message: 'This evaluation is still in progress.' },
    EVALUATION_SUPERSEDED: { status: 409, message: 'A newer evaluation or preference update superseded this evaluation.' },
    EVALUATION_TIMEOUT: { status: 503, message: 'The evaluation deadline was exceeded.' }
  };
  const value = mapping[cause.code];
  return error(value.status, requestId, cause.code, value.message);
}

async function accountRoute(request: ApiRequest, route: RouteName, options: HandlerOptions, recommendationId?: string): Promise<Outcome> {
  if (!request.claims) return error(401, request.requestId, 'UNAUTHORIZED', 'A valid access token is required.');
  const clientIds = [options.clients?.webClientId, options.clients?.mobileClientId].filter(Boolean);
  if (!clientIds.includes(request.claims.clientId)) return error(403, request.requestId, 'FORBIDDEN', 'This client is not allowed to access this API.');
  const userId = request.claims.sub;
  const requestId = request.requestId;
  if (!options.account || (route === 'chat' && !options.chat)) return error(503, requestId, 'SERVICE_UNAVAILABLE', 'This service is not available yet.');
  try {
    if (route === 'me') return { response: json(200, GetMeResponseSchema.parse({ requestId, data: await options.account.getMe(userId) })) };
    if (route === 'recommendations') {
      const query = RecommendationsQuerySchema.safeParse(request.query ?? {});
      if (!query.success) return error(400, requestId, 'VALIDATION_ERROR', 'Recommendation query is invalid.');
      return { response: json(200, ListRecommendationsResponseSchema.parse({ requestId, data: await options.account.listRecommendations(userId, query.data) })) };
    }
    if (route === 'recommendation' || route === 'chat') {
      const params = RecommendationParamsSchema.safeParse({ recommendationId });
      if (!params.success) return error(400, requestId, 'VALIDATION_ERROR', 'Recommendation ID is invalid.');
      if (route === 'recommendation') return { response: json(200, GetRecommendationResponseSchema.parse({ requestId, data: await options.account.getRecommendation(userId, params.data.recommendationId) })) };
    }
    const body = parseBody(request.body);
    if (!body.ok) return body.tooLarge
      ? error(413, requestId, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
      : error(400, requestId, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
    if (route === 'preferences') {
      const parsed = UpdatePreferencesRequestSchema.safeParse(body.value);
      if (!parsed.success) return error(400, requestId, 'VALIDATION_ERROR', 'Preferences are invalid.');
      return { response: json(200, UpdatePreferencesResponseSchema.parse({ requestId, data: await options.account.putPreferences(userId, parsed.data) })) };
    }
    const parsed = ChatRequestSchema.safeParse(body.value);
    if (!parsed.success) return error(400, requestId, 'VALIDATION_ERROR', 'Chat message is invalid.');
    if (!options.chat || !recommendationId) return error(503, requestId, 'SERVICE_UNAVAILABLE', 'This service is not available yet.');
    return { response: json(200, ChatResponseSchema.parse({ requestId, data: await options.chat({ userId, recommendationId, message: parsed.data.message }) })) };
  } catch (cause) {
    if (cause instanceof ApiFailure) return apiFailure(cause, requestId);
    return error(500, requestId, 'INTERNAL_ERROR', 'Request could not be completed.');
  }
}

export function createRequestHandler(options: HandlerOptions): (request: ApiRequest) => Promise<ApiResponse> {
  const clients = options.clients ?? { webClientId: null, mobileClientId: null };
  return async (request) => {
    let route: RouteName = 'not-found';
    let result: Outcome;
    if (request.method === 'GET' && request.path === '/health') {
      route = 'health';
      result = { response: json(200, { status: 'ok', version: options.version } satisfies HealthResponse) };
    } else if (request.method === 'POST' && request.path === '/v1/context/evaluate') {
      route = 'evaluate';
      result = await evaluate(request, clients, options.evaluate);
    } else if (request.method === 'GET' && request.path === '/v1/me') {
      route = 'me';
      result = await accountRoute(request, route, options);
    } else if (request.method === 'PUT' && request.path === '/v1/me/preferences') {
      route = 'preferences';
      result = await accountRoute(request, route, options);
    } else if (request.method === 'GET' && request.path === '/v1/recommendations') {
      route = 'recommendations';
      result = await accountRoute(request, route, options);
    } else if (/^\/v1\/recommendations\/[^/]+(?:\/chat)?$/.test(request.path)
      && ((request.method === 'POST' && request.path.endsWith('/chat')) || (request.method === 'GET' && !request.path.endsWith('/chat')))) {
      route = request.method === 'POST' ? 'chat' : 'recommendation';
      let recommendationId: string | undefined;
      try { recommendationId = decodeURIComponent(request.path.split('/')[3] ?? ''); } catch { /* validated below */ }
      result = await accountRoute(request, route, options, recommendationId);
    } else {
      result = error(404, request.requestId, 'NOT_FOUND', 'Route not found.');
    }
    const { response, mode, errorCode } = result;
    // Never log tokens, claims, bodies, query strings or raw paths.
    options.log({
      event: 'http_request', requestId: request.requestId, route, statusCode: response.statusCode,
      ...(mode ? { mode } : {}), ...(errorCode ? { errorCode } : {})
    });
    return response;
  };
}

const JwtClaimsSchema = z.object({ sub: z.string().min(1), client_id: z.string().min(1), token_use: z.literal('access') });

/** Reads claims only from the API Gateway JWT authorizer context; ID tokens are rejected. */
export function claimsFromEvent(event: APIGatewayProxyEventV2 | APIGatewayProxyEventV2WithJWTAuthorizer): AuthClaims | null {
  const context: unknown = event.requestContext;
  const claims = z.object({ authorizer: z.object({ jwt: z.object({ claims: JwtClaimsSchema }) }) }).safeParse(context);
  return claims.success ? { sub: claims.data.authorizer.jwt.claims.sub, clientId: claims.data.authorizer.jwt.claims.client_id } : null;
}

export function createLambdaHandler(options: HandlerOptions): (event: APIGatewayProxyEventV2 | APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<ApiResponse> {
  const handle = createRequestHandler(options);
  return (event) => handle({
    method: event.requestContext.http.method,
    path: event.rawPath,
    requestId: event.requestContext.requestId,
    body: event.body === undefined ? null : event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body,
    claims: claimsFromEvent(event),
    query: event.queryStringParameters ?? {},
    ...(() => {
      const key = Object.entries(event.headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
      return key === undefined ? {} : { idempotencyKey: key };
    })()
  });
}
