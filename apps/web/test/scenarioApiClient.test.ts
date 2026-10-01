import { describe, expect, it } from 'vitest';
import { getScenarioInput } from '@contextia/test-fixtures';
import type { ScenarioContextInput } from '@contextia/contracts';
import { createScenarioApiClient, evaluateEndpoint } from '../src/execution/scenarioApiClient.js';
import type { ScenarioApiClientOptions } from '../src/execution/scenarioApiClient.js';
import { envelope, notifyResult, recommendationItem, silentResult } from './support/evaluation.js';

const baseUrl = 'https://api.example.test';
const input = getScenarioInput('step-goal');

type Call = { url: string; init: RequestInit | undefined };

function respondWith(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchDouble: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond();
  };
  return { fetch: fetchDouble, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function client(fetchDouble: typeof fetch, overrides: Partial<ScenarioApiClientOptions> = {}) {
  return createScenarioApiClient({ baseUrl, getAccessToken: () => 'access-token', fetch: fetchDouble, ...overrides });
}

describe('evaluate endpoint', () => {
  it.each([
    ['https://abc.execute-api.ap-northeast-1.amazonaws.com', 'https://abc.execute-api.ap-northeast-1.amazonaws.com/v1/context/evaluate'],
    ['https://abc.execute-api.ap-northeast-1.amazonaws.com/', 'https://abc.execute-api.ap-northeast-1.amazonaws.com/v1/context/evaluate'],
    ['https://api.example.test/stage', 'https://api.example.test/stage/v1/context/evaluate'],
    ['http://127.0.0.1:3001', 'http://127.0.0.1:3001/v1/context/evaluate'],
    ['http://localhost:3001/', 'http://localhost:3001/v1/context/evaluate']
  ])('resolves %s', (base, expected) => expect(evaluateEndpoint(base).toString()).toBe(expected));

  it.each(['http://api.example.test', 'ftp://api.example.test', 'https://user:secret@api.example.test', 'https://api.example.test?x=1', 'not a url'])(
    'rejects %s', base => expect(() => evaluateEndpoint(base)).toThrow()
  );
});

describe('scenario API client request', () => {
  it('posts the validated preview context with the bearer token', async () => {
    const { fetch, calls } = respondWith(() => json(200, envelope(notifyResult())));
    await client(fetch).evaluate(input);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.example.test/v1/context/evaluate');
    expect(call?.init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect(call?.init?.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer access-token' });
    expect(JSON.parse(String(call?.init?.body))).toEqual(input);
  });

  it('does not send contract-invalid input', async () => {
    const { fetch, calls } = respondWith(() => json(200, envelope(notifyResult())));
    const outcome = await client(fetch).evaluate({ ...input, location: { ...input.location, latitude: 120 } });
    expect(outcome).toMatchObject({ kind: 'invalid-request', issues: [{ path: 'location.latitude' }] });
    expect(calls).toHaveLength(0);
  });

  it('never sends a real/proactive request from the Console', async () => {
    const { fetch, calls } = respondWith(() => json(200, envelope(notifyResult())));
    const proactive = { ...input, mode: 'real', deliveryMode: 'proactive' } as unknown as ScenarioContextInput;
    expect((await client(fetch).evaluate(proactive)).kind).toBe('invalid-request');
    expect(calls).toHaveLength(0);
  });

  it('does not call the API without an access token', async () => {
    const { fetch, calls } = respondWith(() => json(200, envelope(notifyResult())));
    expect(await client(fetch, { getAccessToken: () => null }).evaluate(input)).toEqual({ kind: 'unauthenticated' });
    expect(await client(fetch, { getAccessToken: () => { throw new Error('storage blocked'); } }).evaluate(input)).toEqual({ kind: 'unauthenticated' });
    expect(calls).toHaveLength(0);
  });
});

describe('scenario API client response validation', () => {
  it('returns schema-valid notify and silent results', async () => {
    const notify = await client(respondWith(() => json(200, envelope(notifyResult()))).fetch).evaluate(input);
    expect(notify).toEqual({ kind: 'success', requestId: 'req-test-1', result: notifyResult() });
    const silent = await client(respondWith(() => json(200, envelope(silentResult(), 'req-test-2'))).fetch).evaluate(input);
    expect(silent).toEqual({ kind: 'success', requestId: 'req-test-2', result: silentResult() });
  });

  it('rejects more than three recommendations', async () => {
    const tooMany = { ...notifyResult(), recommendations: [1, 2, 3, 4].map(recommendationItem) };
    const outcome = await client(respondWith(() => json(200, envelope(tooMany))).fetch).evaluate(input);
    expect(outcome).toMatchObject({ kind: 'invalid-response', status: 200, requestId: 'req-test-1', issues: [{ path: 'data.recommendations' }] });
  });

  it('rejects a response without preview delivery diagnostics', async () => {
    const proactive = { ...notifyResult(), delivery: { mode: 'proactive', status: 'ready', wouldSuppress: false, guardCodes: [] } };
    const outcome = await client(respondWith(() => json(200, envelope(proactive))).fetch).evaluate(input);
    expect(outcome).toMatchObject({ kind: 'invalid-response', issues: [{ path: 'data.delivery.mode' }] });
  });

  const withoutBedrockStatus = () => {
    const providerStatus: Record<string, unknown> = { ...notifyResult().providerStatus };
    delete providerStatus.bedrock;
    return { ...notifyResult(), providerStatus };
  };

  it.each([
    ['a missing provider status', withoutBedrockStatus()],
    ['an unknown field', { ...notifyResult(), chainOfThought: 'hidden' }],
    ['an unsafe action URL', { ...notifyResult(), recommendations: [{ ...recommendationItem(1), action: { type: 'WEBSITE', url: 'javascript:alert(1)' } }] }],
    ['an unknown signal', { ...notifyResult(), usedSignals: ['gps'] }]
  ])('rejects %s', async (_label, data) => {
    const outcome = await client(respondWith(() => json(200, envelope(data))).fetch).evaluate(input);
    expect(outcome.kind).toBe('invalid-response');
  });

  it('rejects a non-JSON success body', async () => {
    const outcome = await client(respondWith(() => new Response('<html>ok</html>', { status: 200 })).fetch).evaluate(input);
    expect(outcome).toEqual({ kind: 'invalid-response', status: 200, requestId: null, issues: [{ path: '', message: 'Response body is not JSON' }] });
  });
});

describe('scenario API client errors', () => {
  it('maps the standard error envelope', async () => {
    const body = { requestId: 'req-400', error: { code: 'VALIDATION_ERROR', message: 'Request body is invalid.', details: [{ path: 'context.location.latitude', message: 'Expected number between -90 and 90.' }] } };
    const outcome = await client(respondWith(() => json(400, body)).fetch).evaluate(input);
    expect(outcome).toEqual({
      kind: 'http-error', status: 400, requestId: 'req-400', code: 'VALIDATION_ERROR', message: 'Request body is invalid.',
      details: [{ path: 'context.location.latitude', message: 'Expected number between -90 and 90.' }]
    });
  });

  it('maps non-envelope gateway errors without exposing the body', async () => {
    const unauthorized = await client(respondWith(() => json(401, { message: 'Unauthorized' })).fetch).evaluate(input);
    expect(unauthorized).toEqual({ kind: 'http-error', status: 401, requestId: null, code: 'HTTP_401', message: null, details: [] });
    const unavailable = await client(respondWith(() => new Response('', { status: 503 })).fetch).evaluate(input);
    expect(unavailable).toMatchObject({ kind: 'http-error', status: 503, code: 'HTTP_503' });
  });

  it('reports network failures', async () => {
    const outcome = await client(respondWith(() => { throw new TypeError('Failed to fetch'); }).fetch).evaluate(input);
    expect(outcome).toEqual({ kind: 'network-error' });
  });

  it('aborts and reports a timeout', async () => {
    let aborted = false;
    const hanging: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
    expect(await client(hanging, { timeoutMs: 5 }).evaluate(input)).toEqual({ kind: 'timeout', timeoutMs: 5 });
    expect(aborted).toBe(true);
  });
});
