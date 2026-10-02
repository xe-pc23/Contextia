import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ContextEvaluateResponseSchema, ErrorResponseSchema } from '@contextia/contracts';
import type { EvaluationResult } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import { MAX_BODY_BYTES, claimsFromEvent, createLambdaHandler, createRequestHandler } from '../src/handler.js';
import type { AuthClaims, ClientConfig, RequestLog } from '../src/handler.js';
import { EvaluationFailure } from '../src/application/evaluateContext.js';
import type { EvaluateContext } from '../src/application/evaluateContext.js';
import { createAccountServices } from '../src/application/account.js';
import { NOW, preferences, repository } from './support/repository.js';

const clients: ClientConfig = { webClientId: 'web-client', mobileClientId: 'mobile-client' };
const preview = getScenarioInput('step-goal');
const proactive = { ...preview, mode: 'real', deliveryMode: 'proactive', location: { ...preview.location, source: 'gps' } };
const webUser: AuthClaims = { sub: 'user-1', clientId: 'web-client' };
const mobileUser: AuthClaims = { sub: 'user-1', clientId: 'mobile-client' };

function setup(clientConfig = clients, evaluate?: EvaluateContext) {
  const logs: RequestLog[] = [];
  const handle = createRequestHandler({ version: 'test', clients: clientConfig, log: entry => { logs.push(entry); }, ...(evaluate ? { evaluate } : {}) });
  const post = (body: unknown, claims: AuthClaims | null = webUser, raw = false) => handle({
    method: 'POST', path: '/v1/context/evaluate', requestId: 'req-eval', claims,
    body: raw ? body as string | null : JSON.stringify(body)
  });
  return { logs, post };
}

async function errorOf(response: Promise<{ statusCode: number; body: string }>) {
  const resolved = await response;
  return { statusCode: resolved.statusCode, ...ErrorResponseSchema.parse(JSON.parse(resolved.body)) };
}

describe('POST /v1/context/evaluate entry', () => {
  it('requires verified access-token claims', async () => {
    expect(await errorOf(setup().post(preview, null))).toMatchObject({ statusCode: 401, error: { code: 'UNAUTHORIZED' } });
  });

  it.each([[null], ['not json'], ['']])('rejects a missing or non-JSON body %j', async (body) => {
    expect(await errorOf(setup().post(body, webUser, true))).toMatchObject({ statusCode: 400, error: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects an oversized body before parsing', async () => {
    const body = JSON.stringify({ padding: 'x'.repeat(MAX_BODY_BYTES) });
    expect(await errorOf(setup().post(body, webUser, true))).toMatchObject({ statusCode: 413, error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('returns contract validation details with paths', async () => {
    const result = await errorOf(setup().post({ ...preview, location: { ...preview.location, latitude: 91 } }));
    expect(result).toMatchObject({ statusCode: 400, requestId: 'req-eval', error: { code: 'VALIDATION_ERROR', details: [{ path: 'location.latitude' }] } });
  });

  it('rejects invalid mode/delivery combinations', async () => {
    const mixed = { ...preview, deliveryMode: 'proactive' };
    expect((await errorOf(setup().post(mixed))).statusCode).toBe(400);
  });

  it('allows preview only from the Scenario Console client', async () => {
    expect(await errorOf(setup().post(preview, mobileUser))).toMatchObject({ statusCode: 403, error: { code: 'FORBIDDEN' } });
  });

  it('allows proactive delivery only from the mobile client', async () => {
    expect(await errorOf(setup().post(proactive, webUser))).toMatchObject({ statusCode: 403, error: { code: 'FORBIDDEN' } });
  });

  it('fails closed when client IDs are not configured', async () => {
    const { post } = setup({ webClientId: null, mobileClientId: null });
    expect((await errorOf(post(preview))).statusCode).toBe(403);
    expect((await errorOf(post(proactive, mobileUser))).statusCode).toBe(403);
  });

  it('reports evaluation as unavailable when no evaluation service is composed', async () => {
    expect(await errorOf(setup().post(preview))).toMatchObject({ statusCode: 503, error: { code: 'EVALUATION_UNAVAILABLE' } });
    expect(await errorOf(setup().post(proactive, mobileUser))).toMatchObject({ statusCode: 503, error: { code: 'EVALUATION_UNAVAILABLE' } });
  });

  it('logs mode and outcome but no claims, location or calendar data', async () => {
    const { post, logs } = setup();
    await post({ ...preview, calendar: [{ id: 'e1', title: 'private meeting', startAt: preview.capturedAt, endAt: preview.capturedAt, location: 'private place' }] });
    expect(logs).toEqual([{ event: 'http_request', requestId: 'req-eval', route: 'evaluate', statusCode: 503, mode: 'simulation', errorCode: 'EVALUATION_UNAVAILABLE' }]);
    expect(JSON.stringify(logs)).not.toMatch(/private|user-1|web-client|35\.68/);
  });
});

describe('POST /v1/context/evaluate with a composed evaluation service', () => {
  const silent: EvaluationResult = {
    evaluationId: 'eval-1', decision: 'silent', recommendationId: null, triggerType: null, urgency: null, message: null,
    recommendations: [], decisionReason: 'No candidate opportunity was detected.', usedSignals: [],
    delivery: { mode: 'preview', status: 'preview', wouldSuppress: true, guardCodes: ['NO_CANDIDATE'] },
    providerStatus: { geocoding: { status: 'not_requested' }, places: { status: 'not_requested' }, weather: { status: 'not_requested' }, routes: { status: 'not_requested' }, bedrock: { status: 'not_requested' } },
    contextExpiresAt: '2026-10-02T05:10:00.000Z'
  };

  it('passes the verified user and validated context, returning the result envelope', async () => {
    const evaluate = vi.fn<EvaluateContext>(() => Promise.resolve(silent));
    const response = await setup(clients, evaluate).post(preview);
    expect(response.statusCode).toBe(200);
    expect(ContextEvaluateResponseSchema.parse(JSON.parse(response.body))).toEqual({ requestId: 'req-eval', data: silent });
    expect(evaluate).toHaveBeenCalledWith({ userId: 'user-1', context: preview });
  });

  it('does not evaluate unauthorized or invalid requests', async () => {
    const evaluate = vi.fn<EvaluateContext>(() => Promise.resolve(silent));
    const { post } = setup(clients, evaluate);
    await post(preview, mobileUser);
    await post({ ...preview, mode: 'bogus' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it.each([
    [new EvaluationFailure('PROFILE_NOT_FOUND'), 404, 'PROFILE_NOT_FOUND'],
    [new EvaluationFailure('STATE_UNAVAILABLE'), 503, 'STATE_UNAVAILABLE'],
    [new Error('secret upstream body'), 500, 'INTERNAL_ERROR']
  ])('maps %s to %i without leaking internal messages', async (failure, statusCode, code) => {
    const { post, logs } = setup(clients, () => Promise.reject(failure));
    const response = await post(preview);
    expect(await errorOf(Promise.resolve(response))).toMatchObject({ statusCode, error: { code } });
    expect(response.body).not.toContain('secret');
    expect(logs[0]).toMatchObject({ statusCode, errorCode: code, mode: 'simulation' });
  });
});

describe('Lambda event mapping', () => {
  const event = (claims: Record<string, string> | null, body: string, isBase64Encoded = false): APIGatewayProxyEventV2WithJWTAuthorizer => ({
    version: '2.0', routeKey: 'POST /v1/context/evaluate', rawPath: '/v1/context/evaluate', rawQueryString: '', headers: {},
    body, isBase64Encoded,
    requestContext: {
      accountId: '634512763705', apiId: 'api', domainName: 'api.example.com', domainPrefix: 'api', requestId: 'req-lambda',
      routeKey: 'POST /v1/context/evaluate', stage: '$default', time: '01/Oct/2026:00:00:00 +0000', timeEpoch: 1790812800000,
      http: { method: 'POST', path: '/v1/context/evaluate', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      authorizer: { principalId: '', integrationLatency: 0, jwt: { claims: claims ?? {}, scopes: [] } }
    }
  });
  const accessClaims = { sub: 'user-1', client_id: 'web-client', token_use: 'access' };

  it('reads access-token claims from the JWT authorizer context', () => {
    expect(claimsFromEvent(event(accessClaims, '{}'))).toEqual({ sub: 'user-1', clientId: 'web-client' });
  });

  it('rejects ID tokens and missing claims', () => {
    expect(claimsFromEvent(event({ ...accessClaims, token_use: 'id' }, '{}'))).toBeNull();
    expect(claimsFromEvent(event(null, '{}'))).toBeNull();
  });

  it('decodes base64 bodies before validation', async () => {
    const handle = createLambdaHandler({ version: 'test', clients, log: () => undefined });
    const response = await handle(event(accessClaims, Buffer.from(JSON.stringify(preview)).toString('base64'), true));
    expect(response.statusCode).toBe(503);
  });
  it('maps the dev fault header case-insensitively and rejects it in production', async () => {
    const faultEvent = { ...event(accessClaims, JSON.stringify(preview)), headers: { 'X-Contextia-Demo-Fault': 'weather' } };
    expect((await createLambdaHandler({ version: 'test', clients, stage: 'prod', log: vi.fn() })(faultEvent)).statusCode).toBe(403);
    expect((await createLambdaHandler({ version: 'test', clients, stage: 'dev', log: vi.fn() })(faultEvent)).statusCode).toBe(503);
  });
  it('maps a mixed-case profile precondition into conditional creation', async () => {
    const state = repository();
    const input = event(accessClaims, JSON.stringify(preferences));
    const handle = createLambdaHandler({ version: 'test', clients, log: vi.fn(), account: createAccountServices(state, () => NOW) });
    const response = await handle({ ...input, rawPath: '/v1/me/preferences', headers: { 'If-None-Match': '*' }, requestContext: { ...input.requestContext, http: { ...input.requestContext.http, method: 'PUT' } } });
    expect(response.statusCode).toBe(200);
    expect(state.putPreferences).toHaveBeenCalledWith({ userId: 'user-1', preferences, at: NOW.toISOString(), createOnly: true });
  });
});
