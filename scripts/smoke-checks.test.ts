import { describe, expect, it, vi } from 'vitest';
import { assertPreviewStateUnchanged, hasLiveTransitProof, liveSmokeContext, nextLiveSmokeTime, runPublicSmoke, smokeProviderDiagnostic } from './smoke-checks.js';
import { ContextEvaluateResponseSchema } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
const target = { stage: 'dev' as const, buildId: 'sha-1', apiBaseUrl: 'https://api.example.com', webUrl: 'https://web.example.com/' };
function server(buildId = 'sha-1', protectedStatus = 401) {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'ok', version: buildId });
    if (url.endsWith('/config.json')) return Response.json({ ...target, apiBaseUrl: target.apiBaseUrl });
    if (url.endsWith('/v1/me')) return Response.json({}, { status: protectedStatus });
    if (url.endsWith('.js')) return new Response('export const ready = true;', { headers: { 'content-type': 'text/javascript' } });
    return new Response('<html><script type="module" src="/assets/app-hash.js"></script></html>');
  });
}
describe('public deployment smoke', () => {
  it('moves fixture times into the live window and uses an unambiguous public station address', () => {
    const at = new Date('2026-10-03T05:10:00Z');
    const preset = getScenarioInput('upcoming-transit');
    const live = liveSmokeContext('upcoming-transit', at);
    expect(live.deliveryMode).toBe('preview'); expect(live.scenarioTime).toBe(at.toISOString());
    expect(live.calendar[0]?.location).toBe('東京都渋谷区渋谷2丁目24番12号 渋谷駅');
    expect(Date.parse(live.calendar[0]!.startAt) - at.getTime()).toBe(Date.parse(preset.calendar[0]!.startAt) - Date.parse(preset.scenarioTime!));
    expect(getScenarioInput('upcoming-transit')).toEqual(preset);
  });
  it('keeps early arrival within its public destination radius', () => {
    const live = liveSmokeContext('early-arrival', new Date('2026-10-03T05:10:00Z'));
    expect(live.location.latitude).toBeCloseTo(35.658034, 5);
    expect(live.location.longitude).toBeCloseTo(139.701636, 5);
    expect(live.calendar[0]?.location).toContain('渋谷駅');
  });
  it('selects the next daytime slot at least ten minutes ahead, including midnight and slot boundaries', () => {
    expect(nextLiveSmokeTime(new Date('2026-10-03T14:30:00Z')).toISOString()).toBe('2026-10-04T05:10:00.000Z');
    expect(nextLiveSmokeTime(new Date('2026-10-03T14:58:00Z')).toISOString()).toBe('2026-10-04T05:10:00.000Z');
    expect(nextLiveSmokeTime(new Date('2026-10-03T05:00:00Z')).toISOString()).toBe('2026-10-03T05:10:00.000Z');
    expect(nextLiveSmokeTime(new Date('2026-10-03T05:00:00.001Z')).toISOString()).toBe('2026-10-04T05:10:00.000Z');
  });
  it('does not treat pedestrian success or an aggregate degraded status as proof of scheduled transit', () => {
    const data = { providerStatus: { routes: { status: 'degraded', code: 'NO_TRANSIT_ROUTE' } }, recommendations: [] };
    expect(hasLiveTransitProof(data as unknown as Parameters<typeof hasLiveTransitProof>[0])).toBe(false);
    const transit = { mode: 'transit', durationMinutes: 20, departAt: '2026-10-03T05:10:00Z', arriveAt: '2026-10-03T05:30:00Z' };
    expect(hasLiveTransitProof({ ...data, recommendations: [{ route: transit }] } as unknown as Parameters<typeof hasLiveTransitProof>[0])).toBe(true);
    expect(hasLiveTransitProof({ ...data, recommendations: [{ route: { ...transit, mode: 'pedestrian' } }] } as unknown as Parameters<typeof hasLiveTransitProof>[0])).toBe(false);
    expect(hasLiveTransitProof({ ...data, recommendations: [{ route: { ...transit, arriveAt: undefined } }] } as unknown as Parameters<typeof hasLiveTransitProof>[0])).toBe(false);
  });
  it('keeps provider diagnostics useful without response prose or arbitrary codes', () => {
    const result = ContextEvaluateResponseSchema.parse({ requestId: 'req-safe', data: {
      evaluationId: 'eval-1', recommendationId: null, decision: 'silent', triggerType: null, urgency: null,
      decisionReason: 'private prose', message: null, recommendations: [], usedSignals: [], contextExpiresAt: '2026-10-04T00:00:00Z',
      delivery: { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: [] },
      providerStatus: { geocoding: { status: 'not_requested' }, places: { status: 'error', code: 'UPSTREAM_AUTH' }, weather: { status: 'not_requested' }, routes: { status: 'unavailable', code: 'private-token' }, bedrock: { status: 'timeout', code: 'TIMEOUT' } }
    } });
    const diagnostic = smokeProviderDiagnostic('step-goal', result);
    expect(diagnostic).toContain('req-safe'); expect(diagnostic).toContain('UPSTREAM_AUTH'); expect(diagnostic).toContain('TIMEOUT');
    expect(diagnostic).not.toContain('private');
    expect(smokeProviderDiagnostic('step-goal', { ...result, requestId: 'AbcD_12345678+=' })).toContain('AbcD_12345678+=');
  });
  it('verifies the exact SHA, runtime config, built JS and unauthorized API boundary', async () => {
    const fetcher = server(); await runPublicSmoke(target, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('rejects a stale API build even when health is successful', async () => {
    await expect(runPublicSmoke(target, server('old-sha'))).rejects.toThrow('build ID');
  });
  it('rejects an open protected API', async () => {
    await expect(runPublicSmoke(target, server('sha-1', 200))).rejects.toThrow('unauthenticated');
  });
});
describe('preview delivery invariants', () => {
  const state = { notificationDay: '2026-10-02', notificationsSentToday: 2, recentAnchors: [{ triggerType: 'STEP_GOAL_REST' as const, anchorKey: 'today', notifiedAt: '2026-10-02T10:00:00Z' }] };
  it('allows context persistence while leaving delivery state unchanged', () => {
    expect(() => assertPreviewStateUnchanged(state, { ...state, latestContext: { evaluationId: 'new', capturedAt: '2026-10-02T10:00:00Z' } })).not.toThrow();
    expect(() => assertPreviewStateUnchanged(null, { notificationDay: '2026-10-02', notificationsSentToday: 0, recentAnchors: [] })).not.toThrow();
  });
  it('rejects a preview increment or new delivery anchor', () => {
    expect(() => assertPreviewStateUnchanged(state, { ...state, notificationsSentToday: 3 })).toThrow('Preview mutated');
    expect(() => assertPreviewStateUnchanged(state, { ...state, recentAnchors: [] })).toThrow('Preview mutated');
  });
});
