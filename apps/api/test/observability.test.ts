import { describe, expect, it } from 'vitest';
import { createMetrics } from '../src/observability.js';
describe('bounded private-free CloudWatch metrics', () => {
  it('counts actual provider calls and latency while keeping payloads out of dimensions/logs', async () => {
    const entries: unknown[] = []; const metrics = createMetrics('dev', entry => entries.push(entry));
    const result = await metrics.provider('places', 'searchNearby', async () => ({ status: 'ok', data: { token: 'private-token', latitude: 35 } }));
    expect(result.data).toEqual({ token: 'private-token', latitude: 35 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ Stage: 'dev', Provider: 'places', Operation: 'searchNearby', Status: 'ok', Count: 1, Errors: 0, Latency: expect.any(Number) });
    expect(JSON.stringify(entries)).not.toContain('private-token'); expect(JSON.stringify(entries)).not.toContain('latitude');
  });
  it('records thrown/timeout failures and does not let metric transport alter provider results', async () => {
    const entries: unknown[] = []; const metrics = createMetrics('prod', entry => entries.push(entry));
    await expect(metrics.provider('weather', 'getWeather', async () => { throw new Error('private'); })).rejects.toThrow('private');
    expect(entries[0]).toMatchObject({ Status: 'error', Errors: 1 });
    const failing = createMetrics('dev', () => { throw new Error('transport'); });
    expect(await failing.provider('routes', 'getRoute', async () => ({ status: 'timeout', data: null, code: 'TIMEOUT' }))).toMatchObject({ status: 'timeout' });
  });
});
