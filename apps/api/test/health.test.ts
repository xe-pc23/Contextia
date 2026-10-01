import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createLambdaHandler, createRequestHandler } from '../src/handler.js';
import type { RequestLog } from '../src/handler.js';

function setup() {
  const logs: RequestLog[] = [];
  return { logs, options: { version: 'abc123', log: (entry: RequestLog) => { logs.push(entry); } } };
}

describe('health API', () => {
  it('returns the documented liveness body and build ID', () => {
    const { options } = setup();
    const response = createRequestHandler(options)({ method: 'GET', path: '/health', requestId: 'req-health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(response.body)).toEqual({ status: 'ok', version: 'abc123' });
  });

  it.each([['POST', '/health'], ['GET', '/v1/context/evaluate'], ['GET', '/health/private']])('returns 404 for %s %s', (method, path) => {
    const { options } = setup();
    const response = createRequestHandler(options)({ method, path, requestId: 'req-missing' });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({ requestId: 'req-missing', error: { code: 'NOT_FOUND' } });
  });

  it('maps an HTTP API event without logging its headers, body, query, or private path', () => {
    const { options, logs } = setup();
    const event: APIGatewayProxyEventV2 = {
      version: '2.0', routeKey: 'GET /health', rawPath: '/health', rawQueryString: 'token=private-query',
      headers: { authorization: 'Bearer private-token' }, body: 'private-calendar', isBase64Encoded: false,
      requestContext: {
        accountId: '634512763705', apiId: 'api', domainName: 'api.example.com', domainPrefix: 'api', requestId: 'req-lambda',
        routeKey: 'GET /health', stage: '$default', time: '01/Oct/2026:00:00:00 +0000', timeEpoch: 1790812800000,
        http: { method: 'GET', path: '/health', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'smoke-test' }
      }
    };
    const handle = createLambdaHandler(options);
    expect(handle(event).statusCode).toBe(200);
    handle({ ...event, rawPath: '/users/private-user-id' });
    expect(logs).toEqual([
      { event: 'http_request', requestId: 'req-lambda', route: 'health', statusCode: 200 },
      { event: 'http_request', requestId: 'req-lambda', route: 'not-found', statusCode: 404 }
    ]);
    expect(JSON.stringify(logs)).not.toContain('private');
  });
});
