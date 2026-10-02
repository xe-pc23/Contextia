import { expect, it } from 'vitest';
import { metricCoverage } from './metrics-smoke.js';

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
