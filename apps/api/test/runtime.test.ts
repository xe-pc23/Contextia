import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { composeRuntime, createRuntimeHandler } from '../src/runtime.js';

const event: APIGatewayProxyEventV2 = {
  version: '2.0', routeKey: 'GET /health', rawPath: '/health', rawQueryString: '', headers: {}, isBase64Encoded: false,
  requestContext: { accountId: '634512763705', apiId: 'api', domainName: 'example.com', domainPrefix: 'api', requestId: 'req',
    routeKey: 'GET /health', stage: '$default', time: '', timeEpoch: 0,
    http: { method: 'GET', path: '/health', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' } }
};
describe('Lambda runtime composition', () => {
  it('serves liveness without composing providers or requiring model configuration', async () => {
    const compose = vi.fn();
    expect((await createRuntimeHandler({ BUILD_ID: 'sha-1' }, vi.fn(), compose)(event)).body).toBe(JSON.stringify({ status: 'ok', version: 'sha-1' }));
    expect(compose).not.toHaveBeenCalled();
  });
  it('reports missing runtime configuration without exposing its values', async () => {
    const handle = createRuntimeHandler({ BEDROCK_MODEL_ID: 'private-value' }, vi.fn());
    const response = await handle({ ...event, rawPath: '/v1/me' });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private-value');
  });
  it('connects real adapter factories to the evaluation, account and chat services', () => {
    const runtime = composeRuntime({ CONTEXTIA_STAGE: 'dev', AWS_REGION: 'ap-northeast-1', TABLE_NAME: 'contextia-dev-data', BEDROCK_MODEL_ID: 'configured-model', WEB_CLIENT_ID: 'web', MOBILE_CLIENT_ID: 'mobile' }, vi.fn());
    expect(runtime.evaluate).toBeTypeOf('function');
    expect(runtime.chat).toBeTypeOf('function');
    expect(runtime.account?.putPreferences).toBeTypeOf('function');
    expect(runtime.clients).toEqual({ webClientId: 'web', mobileClientId: 'mobile' });
  });
});
