import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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
    expect(html).toContain('天気（Open-Meteo） が正常に応答していません');
  });

  it('shows preview suppression diagnostics without hiding the recommendation', () => {
    const html = success(notifyResult(1));
    expect(html).toContain('プレビューのため通知は送信されず');
    expect(html).toContain('直前に同じ状況を評価済み');
    expect(html).toContain('DUPLICATE_CONTEXT');
    expect(count(html, 'class="recommendation-card"')).toBe(1);
  });

  it('opens validated action URLs in a new tab without opener access', () => {
    const html = success(notifyResult(1));
    expect(html).toContain('href="https://example.invalid/map/1" target="_blank" rel="noopener noreferrer"');
  });

  it('renders route facts in the scenario timezone', () => {
    const item = { ...recommendationItem(1), place: null, route: { mode: 'transit' as const, durationMinutes: 34, departAt: '2026-10-01T06:10:00Z', arriveAt: '2026-10-01T06:44:00Z', transfers: 1 }, action: { type: 'TRANSIT' as const, url: null } };
    const html = success({ ...notifyResult(1), recommendations: [item] });
    expect(html).toContain('公共交通 34分');
    expect(html).toContain('15:10 発 → 15:44 着');
    expect(html).toContain('乗換1回');
    expect(html).toContain('経路を開く（リンクなし）');
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
