import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { z } from 'zod';
import { ContextEvaluateRequestSchema } from '@contextia/contracts';
import type { ContextEvaluateRequest, ErrorResponse, HealthResponse } from '@contextia/contracts';

export const MAX_BODY_BYTES = 256 * 1024;

export type RouteName = 'health' | 'evaluate' | 'not-found';

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

export type HandlerOptions = { version: string; log: (entry: RequestLog) => void; clients?: ClientConfig };

/** Verified access-token claims supplied by the API Gateway JWT authorizer. */
export type AuthClaims = { sub: string; clientId: string };

export type ApiRequest = { method: string; path: string; requestId: string; body?: string | null; claims?: AuthClaims | null };

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

function evaluate(request: ApiRequest, clients: ClientConfig): Outcome {
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
  // Preview is limited to the Scenario Console client; proactive delivery to the mobile client.
  const allowedClient = mode === 'simulation' ? clients.webClientId : clients.mobileClientId;
  if (!allowedClient || request.claims.clientId !== allowedClient) {
    return { ...error(403, requestId, 'FORBIDDEN', 'This client is not allowed to request this evaluation mode.'), mode };
  }
  return { ...error(503, requestId, 'EVALUATION_UNAVAILABLE', 'Context evaluation is not available yet.'), mode };
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
      result = evaluate(request, clients);
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
    claims: claimsFromEvent(event)
  });
}

export const handler = createLambdaHandler({
  version: process.env.BUILD_ID ?? 'development',
  clients: { webClientId: process.env.WEB_CLIENT_ID ?? null, mobileClientId: process.env.MOBILE_CLIENT_ID ?? null },
  log: (entry) => { console.log(JSON.stringify(entry)); }
});
