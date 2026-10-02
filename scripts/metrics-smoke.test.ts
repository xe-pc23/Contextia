import { afterEach, expect, it, vi } from 'vitest';
import { metricCoverage, verifyDevMetrics } from './metrics-smoke.js';

const logReader = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: class { send = logReader; },
  FilterLogEventsCommand: class { constructor(readonly input: unknown) {} }
}));
afterEach(() => { logReader.mockReset(); vi.useRealTimers(); });

const proof = { successRequestId: 'chat-good', invalidRequestId: 'chat-invalid',
  canaries: ['synthetic-success-canary', 'synthetic-invalid-canary'] as [string, string],
  accessTokens: ['synthetic-web-token', 'synthetic-other-token', 'synthetic-mobile-token'] as [string, string, string] };
const coverage = [
  { Provider: 'http', Operation: 'request', Latency: 1 }, { Provider: 'evaluation', Operation: 'evaluate', Latency: 1 },
  { Provider: 'places', Operation: 'searchNearby', Latency: 1 }, { Provider: 'modelAttempt', Operation: 'initial', Latency: 1 },
  { Decision: 'notify', TriggerType: 'STEP_GOAL_REST' }, { Decision: 'silent', TriggerType: 'NONE' }
].map(record => JSON.stringify({ _aws: { CloudWatchMetrics: [{ Namespace: 'Contextia' }] }, Stage: 'dev', Count: 1, ...record }));
const requests = [
  JSON.stringify({ event: 'http_request', requestId: 'chat-good', route: 'chat', statusCode: 200 }),
  JSON.stringify({ event: 'http_request', requestId: 'chat-invalid', route: 'chat', statusCode: 400, errorCode: 'VALIDATION_ERROR' })
];
function page(messages: string[], nextToken?: string) {
  return { events: messages.map(message => ({ message })), ...(nextToken ? { nextToken } : {}) };
}

it('requires safe EMF records for request/provider/model/evaluation and both decisions', () => {
  const emf = { _aws: { CloudWatchMetrics: [{ Namespace: 'Contextia' }] }, Stage: 'dev', Count: 1 };
  const messages = [
    { Provider: 'http', Operation: 'request', Status: 'ok', Latency: 2 },
    { Provider: 'evaluation', Operation: 'evaluate', Status: 'ok', Latency: 10 },
    { Provider: 'places', Operation: 'searchNearby', Status: 'ok', Latency: 2 },
    { Provider: 'modelAttempt', Operation: 'initial', Status: 'ok', Latency: 2 },
    { Decision: 'notify', TriggerType: 'STEP_GOAL_REST' }, { Decision: 'silent', TriggerType: 'NONE' }
  ].map(entry => JSON.stringify({ ...emf, ...entry }));
  expect(metricCoverage(messages)).toBe(true);
  expect(metricCoverage(messages.slice(0, -1))).toBe(false);
  expect(metricCoverage(messages.map(message => message.replace('"dev"', '"prod"')))).toBe(false);
  expect(metricCoverage(['private-token', 'malformed', '{}'])).toBe(false);
});

it('recognizes Lambda JSON envelopes and TEXT prefixes using the inner record', () => {
  expect(metricCoverage(coverage.map(message => JSON.stringify({ timestamp: '2026-10-03T00:00:00Z', level: 'INFO', requestId: 'lambda-id', message })))).toBe(true);
  expect(metricCoverage(coverage.map(message => `2026-10-03T00:00:00.000Z\tlambda-id\tINFO\t${message}\n`))).toBe(true);
});

it.each([...proof.canaries, ...proof.accessTokens])('rejects a private needle in any fetched log, including non-JSON records', async needle => {
  logReader.mockResolvedValue(page([...coverage, ...requests, `unparseable output ${needle}`]));
  await expect(verifyDevMetrics(100, proof)).rejects.toThrow();
});

it('rejects an unexpected field on a correlated structured request', async () => {
  logReader.mockResolvedValue(page([...coverage, requests[1]!, JSON.stringify({ event: 'http_request', requestId: 'chat-good', route: 'chat', statusCode: 200, body: 'not-allowed' })]));
  await expect(verifyDevMetrics(100, proof)).rejects.toThrow();
});

it('does not use Lambda invocation IDs or unrelated routes as chat proof', async () => {
  vi.useFakeTimers();
  logReader.mockResolvedValue(page([...coverage, ...requests.map(message => JSON.stringify({ level: 'INFO', requestId: JSON.parse(message).requestId as string,
    message: { event: 'http_request', requestId: 'different-app-id', route: 'health', statusCode: 200 } }))]));
  const result = verifyDevMetrics(100, proof).then(() => true, () => false);
  await vi.advanceTimersByTimeAsync(50_000); expect(await result).toBe(false);
});

it('fails closed when pagination cycles or exceeds its bounded window', async () => {
  logReader.mockResolvedValue(page([...coverage, ...requests], 'same-token'));
  await expect(verifyDevMetrics(100, proof)).rejects.toThrow();
  let cursor = 0;
  logReader.mockImplementation(async () => page([...coverage, ...requests], `token-${++cursor}`));
  await expect(verifyDevMetrics(100, proof)).rejects.toThrow();
});

it('reads empty intermediate pages and scans the unfiltered fixed dev window', async () => {
  logReader.mockImplementation(async (command: { input: { filterPattern?: string; logGroupName: string; startTime: number; endTime?: number; nextToken?: string } }) => {
    if (command.input.filterPattern || command.input.logGroupName !== '/aws/lambda/contextia-dev-api' || command.input.startTime !== 100 || !command.input.endTime) throw new Error('Wrong log boundary');
    return command.input.nextToken ? page([...coverage, ...requests]) : page([], 'next');
  });
  await expect(verifyDevMetrics(100, proof)).resolves.toBeUndefined();
});

it.each([{ ...proof, canaries: ['', 'canary'] as [string, string] }, { ...proof, successRequestId: 'chat-invalid' },
  { ...proof, accessTokens: ['', 'other', 'mobile'] as [string, string, string] }])('rejects incomplete correlation and secret-scan evidence', async evidence => {
  logReader.mockResolvedValue(page([...coverage, ...requests]));
  await expect(verifyDevMetrics(100, evidence)).rejects.toThrow();
});
