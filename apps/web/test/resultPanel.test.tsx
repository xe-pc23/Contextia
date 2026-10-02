import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeliveryGuardCodeSchema } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import type { EvaluationResult } from '@contextia/contracts';
import { settleRun } from '../src/execution/runState.js';
import type { EvaluateOutcome } from '../src/execution/scenarioApiClient.js';
import { ResultPanel } from '../src/result/ResultPanel.js';
import { notifyResult, recommendationItem, silentResult } from './support/evaluation.js';

const request = getScenarioInput('step-goal');

function render(outcome: EvaluateOutcome): string {
  return renderToStaticMarkup(<ResultPanel state={settleRun(request, outcome, 1234)} timeZone="Asia/Tokyo" />);
}
function success(result: EvaluationResult): string {
  return render({ kind: 'success', requestId: 'req-test-1', result });
}
const count = (html: string, text: string) => html.split(text).length - 1;

describe('result panel states', () => {
  it('shows no result before the first run', () => {
    const html = renderToStaticMarkup(<ResultPanel state={{ status: 'idle' }} timeZone="Asia/Tokyo" />);
    expect(html).toContain('まだ評価していません');
    expect(html).not.toContain('recommendation-card');
  });

  it('marks the region busy while evaluating', () => {
    const html = renderToStaticMarkup(<ResultPanel state={{ status: 'running', request }} timeZone="Asia/Tokyo" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('評価中');
  });
});

describe('notify result', () => {
  it('shows returned normalized values separately from the sent request', () => {
    const html = success({ ...notifyResult(1), normalizedContext: {
      mode: 'simulation', evaluationAt: request.capturedAt, timezone: 'Europe/London', stepGoal: 8000,
      location: request.location, calendar: [], preferences: {
        interests: ['server-interest'], stepGoal: 8000, notificationFrequency: 'normal', notificationsEnabled: true, locale: 'ja-JP', timezone: 'Europe/London'
      }
    } });
    expect(html).toContain('サーバーで正規化したコンテキストを表示');
    expect(html).toContain('server-interest');
    expect(html).toContain('&quot;stepGoal&quot;: 8000');
    expect(html).toContain('送信したコンテキストを表示');
  });
  it('renders the message, trigger, reason and at most three cards', () => {
    const html = success(notifyResult(3));
    expect(html).toContain('通知する判断');
    expect(html).toContain('目標歩数を達成しました。近くで少し休憩しませんか？');
    expect(html).toContain('歩数目標達成後の休憩');
    expect(html).toContain('Step goal reached and nearby rest options are available.');
    expect(count(html, 'class="recommendation-card"')).toBe(3);
    expect(html).toContain('場所: テスト施設 2（約300 m）');
  });

  it('marks used and unused signals', () => {
    const html = success(notifyResult(1));
    expect(count(html, '✓')).toBe(4);
    expect(count(html, '○')).toBe(4);
    expect(html).toContain('（未使用）');
  });

  it('shows every provider status with latency and diagnostic code', () => {
    const html = success(notifyResult(1));
    for (const label of ['ジオコーディング', '周辺施設（Places）', '天気（Open-Meteo）', '経路（Routes）', 'AI判断（Bedrock）']) expect(html).toContain(label);
    expect(html).toContain('status-timeout');
    expect(html).toContain('2000 ms');
    expect(html).toContain('WEATHER_TIMEOUT');
    expect(html).toContain('天気（Open-Meteo） から十分なデータを取得できませんでした');
  });

  it('shows preview suppression diagnostics without hiding the recommendation', () => {
    const html = success(notifyResult(1));
    expect(html).toContain('プレビューのため通知は送信されず');
    expect(html).toContain('直前に同じ状況を評価済み');
    expect(html).toContain('DUPLICATE_CONTEXT');
    expect(html).toContain('wouldSuppress=true');
    expect(count(html, 'class="recommendation-card"')).toBe(1);
  });

  it('opens validated action URLs in a new tab without opener access', () => {
    const html = success(notifyResult(1));
    expect(html).toContain('href="https://example.invalid/map/1" target="_blank" rel="noopener noreferrer"');
  });

  it('renders route facts in the scenario timezone', () => {
    const item = { ...recommendationItem(1), place: null, route: { mode: 'transit' as const, durationMinutes: 34,
      departAt: '2026-10-01T06:10:00Z', arriveAt: '2026-10-01T06:44:00Z', transfers: 1,
      attributions: [{ type: 'Disclaimer' as const, text: 'Transit terms', url: 'https://example.com/terms' }] },
      action: { type: 'TRANSIT' as const, url: null } };
    const html = success({ ...notifyResult(1), recommendations: [item] });
    expect(html).toContain('公共交通 34分');
    expect(html).toContain('15:10 発 → 15:44 着');
    expect(html).toContain('乗換1回');
    expect(html).toContain('経路を開く（リンクなし）');
    expect(html).toContain('href="https://example.com/terms"');
    expect(html).toContain('Transit terms');
  });

  it('rounds a fractional route duration upward in the recommendation card', () => {
    const item = { ...recommendationItem(1), route: { mode: 'transit' as const, durationMinutes: 601 / 60 } };
    const html = success({ ...notifyResult(1), recommendations: [item] });
    expect(html).toContain('公共交通 11分');
    expect(html).not.toContain('公共交通 10分');
  });

  it('escapes response text', () => {
    const html = success({ ...notifyResult(1), message: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows identifiers and the sent context for developers', () => {
    const html = success(notifyResult(1));
    expect(html).toContain('req-test-1');
    expect(html).toContain('eval-test-1');
    expect(html).toContain('1234 ms');
    expect(html).toContain('&quot;deliveryMode&quot;: &quot;preview&quot;');
  });
});

describe('silent result', () => {
  it('explains the silent decision without cards', () => {
    const html = success(silentResult());
    expect(html).toContain('今は通知しない判断（silent）');
    expect(html).toContain('No candidate is useful enough to interrupt the user.');
    expect(html).not.toContain('recommendation-card');
    expect(html).toContain('実際の配信でも抑止条件には該当しません');
    expect(html).toContain('wouldSuppress=false');
  });
});

describe('provider degradation and delivery diagnostics', () => {
  it.each([
    ['ok', '正常', false], ['degraded', '一部劣化', true], ['unavailable', '利用不可', true],
    ['timeout', 'タイムアウト', true], ['error', 'エラー', true], ['not_requested', '未使用', false]
  ] as const)('renders weather=%s while preserving successful providers and cards', (status, label, warns) => {
    const result = notifyResult(3);
    const html = success({ ...result, providerStatus: { ...result.providerStatus, weather: { status, latencyMs: 42, code: 'WEATHER_STATUS' } } });
    expect(html).toContain(`status-${status}`);
    expect(html).toContain(label);
    expect(html).toContain('42 ms');
    expect(html).toContain('WEATHER_STATUS');
    expect(html.includes('から十分なデータを取得できませんでした')).toBe(warns);
    expect(html).toContain('周辺施設（Places）');
    expect(html).toContain('AI判断（Bedrock）');
    expect(count(html, 'status-ok')).toBeGreaterThanOrEqual(2);
    expect(count(html, 'class="recommendation-card"')).toBe(3);
  });

  it('renders an unavailable-provider silent result without inventing recommendations', () => {
    const result = silentResult();
    const html = success({ ...result, providerStatus: { ...result.providerStatus, routes: { status: 'unavailable', code: 'NO_TRANSIT_COVERAGE' } } });
    expect(html).toContain('今は通知しない判断（silent）');
    expect(html).toContain('NO_TRANSIT_COVERAGE');
    expect(html).not.toContain('recommendation-card');
  });

  it.each(DeliveryGuardCodeSchema.options)('shows %s without hiding preview content', code => {
    const html = success({ ...notifyResult(3), delivery: { mode: 'preview', status: 'preview', wouldSuppress: true, guardCodes: [code] } });
    expect(html).toContain(code);
    expect(html).toContain('wouldSuppress=true');
    expect(html).toContain('通知回数にも数えません');
    expect(count(html, 'class="recommendation-card"')).toBe(3);
  });

  it('displays all delivery guards together without interpreting them as an API failure', () => {
    const html = success({ ...notifyResult(1), delivery: { mode: 'preview', status: 'preview', wouldSuppress: true, guardCodes: [...DeliveryGuardCodeSchema.options] } });
    for (const code of DeliveryGuardCodeSchema.options) expect(html).toContain(code);
    expect(html).not.toContain('role="alert"');
    expect(count(html, 'class="recommendation-card"')).toBe(1);
  });
});

describe('sent context', () => {
  it('offers a closed native toggle for the exact validated request, separate from later input edits', () => {
    const state = settleRun(request, { kind: 'success', requestId: 'req-test-1', result: notifyResult(1) }, 1234);
    const html = renderToStaticMarkup(<ResultPanel state={state} timeZone="Asia/Tokyo" inputsChanged />);
    expect(html).toContain('入力は送信時から変更されています');
    expect(html).toContain('変更後の入力は、次の実行で評価します');
    expect(html).toContain('<details class="debug">');
    expect(html).not.toContain('<details class="debug" open');
    expect(html).toContain('送信したコンテキストを表示（共通スキーマ検証済み）');
    expect(html).toContain('&quot;latitude&quot;: 35.681236');
    expect(html).toContain('&quot;deliveryMode&quot;: &quot;preview&quot;');
    expect(count(html, 'class="recommendation-card"')).toBe(1);
  });

  it('does not mark an unchanged or unsubmitted context as an old result', () => {
    expect(success(notifyResult(1))).not.toContain('入力は送信時から変更されています');
    const html = renderToStaticMarkup(<ResultPanel state={{ status: 'idle' }} timeZone="Asia/Tokyo" inputsChanged />);
    expect(html).not.toContain('入力は送信時から変更されています');
    expect(html).not.toContain('class="debug"');
  });
});

describe('failures', () => {
  it.each([
    [{ kind: 'http-error', status: 401, requestId: null, code: 'HTTP_401', message: null, details: [] }, 'ログインの有効期限が切れたか'],
    [{ kind: 'http-error', status: 403, requestId: 'req-403', code: 'FORBIDDEN', message: 'Preview is not allowed.', details: [] }, 'プレビュー評価が許可されていません'],
    [{ kind: 'http-error', status: 429, requestId: null, code: 'HTTP_429', message: null, details: [] }, 'リクエストが多すぎます'],
    [{ kind: 'http-error', status: 502, requestId: null, code: 'HTTP_502', message: null, details: [] }, 'サーバー側でエラーが発生しました'],
    [{ kind: 'network-error' }, '評価APIに接続できませんでした'],
    [{ kind: 'timeout', timeoutMs: 30_000 }, '30秒以内に応答しませんでした'],
    [{ kind: 'unauthenticated' }, 'ログインが必要です']
  ] satisfies [EvaluateOutcome, string][])('explains %j', (failure, text) => {
    const html = render(failure);
    expect(html).toContain('role="alert"');
    expect(html).toContain(text);
    expect(html).not.toContain('recommendation-card');
  });

  it('lists API validation details and the request ID', () => {
    const html = render({
      kind: 'http-error', status: 400, requestId: 'req-400', code: 'VALIDATION_ERROR', message: 'Request body is invalid.',
      details: [{ path: 'context.location.latitude', message: 'Expected number between -90 and 90.' }]
    });
    expect(html).toContain('入力がAPIの検証で拒否されました');
    expect(html).toContain('VALIDATION_ERROR');
    expect(html).toContain('context.location.latitude');
    expect(html).toContain('req-400');
  });

  it('does not display a response that broke the contract', () => {
    const html = render({ kind: 'invalid-response', status: 200, requestId: 'req-bad', issues: [{ path: 'data.recommendations', message: 'Too big' }] });
    expect(html).toContain('共通スキーマに一致しないため、結果を表示しません');
    expect(html).toContain('data.recommendations');
    expect(html).not.toContain('recommendation-card');
  });
});
