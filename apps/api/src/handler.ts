import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ErrorResponse, HealthResponse } from '@contextia/contracts';

export type RequestLog = {
  event: 'http_request';
  requestId: string;
  route: 'health' | 'not-found';
  statusCode: number;
};

export type ApiResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export type HandlerOptions = { version: string; log: (entry: RequestLog) => void };
export type ApiRequest = { method: string; path: string; requestId: string };

export function createRequestHandler(options: HandlerOptions): (request: ApiRequest) => ApiResponse {
  return (request) => {
    const isHealth = request.method === 'GET' && request.path === '/health';
    const statusCode = isHealth ? 200 : 404;
    options.log({ event: 'http_request', requestId: request.requestId, route: isHealth ? 'health' : 'not-found', statusCode });
    return {
      statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify(isHealth
        ? { status: 'ok', version: options.version } satisfies HealthResponse
        : { requestId: request.requestId, error: { code: 'NOT_FOUND', message: 'Route not found.' } } satisfies ErrorResponse)
    };
  };
}

export const handler = createLambdaHandler({
  version: process.env.BUILD_ID ?? 'development',
  log: (entry) => { console.log(JSON.stringify(entry)); }
});

export function createLambdaHandler(options: HandlerOptions): (event: APIGatewayProxyEventV2) => ApiResponse {
  const handle = createRequestHandler(options);
  return (event) => handle({ method: event.requestContext.http.method, path: event.rawPath, requestId: event.requestContext.requestId });
}
