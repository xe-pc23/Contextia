import { describe, expect, it, vi } from 'vitest';
import { assertPreviewStateUnchanged, runPublicSmoke, smokeProviderDiagnostic } from './smoke-checks.js';
import { ContextEvaluateResponseSchema } from '@contextia/contracts';
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
