import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App.js';
import type { ScenarioEvaluator } from '../src/execution/scenarioApiClient.js';
import { CONSOLE_PRESETS } from '../src/scenario/presets.js';

const runButton = /<button type="button" class="primary"( disabled="")?[^>]*>シナリオを実行<\/button>/;
const fixedNow = () => new Date('2026-10-01T14:10:00+09:00');

describe('Scenario Console shell', () => {
  it('states that the API is unconnected and blocks running', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: ['評価APIのURL', 'Cognitoログイン'] }} now={fixedNow} />);
    expect(html).toContain('評価APIに未接続です');
    expect(html).toContain('接続待ち: 評価APIのURL、Cognitoログイン');
    expect(runButton.exec(html)?.[1]).toBe(' disabled=""');
    expect(html).toContain('評価APIとログインが未接続のため実行できません');
    expect(html).not.toContain('recommendation-card');
  });

  it('starts from the step-goal preset inputs with preview delivery fixed', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: [] }} now={fixedNow} />);
    for (const value of ['35.681236', '139.767125', '2026-10-01T14:10', 'Asia/Tokyo', '10432', '10000', 'cafe, park']) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html).toContain('目標達成: 達成');
    expect(html).toContain('送信値: 2026-10-01T14:10:00+09:00');
    expect(html).toContain('deliveryMode=preview');
    expect(html).toContain('&quot;mode&quot;: &quot;simulation&quot;');
  });

  it('shows the map as unconnected instead of a fake map', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: [] }} now={fixedNow} />);
    expect(html).toContain('地図（MapLibre + Amazon Location）は未接続です');
    expect(html).toContain('現在の座標 <strong>35.681236, 139.767125</strong>');
  });

  it('enables running once an evaluator is connected', () => {
    const evaluator: ScenarioEvaluator = { evaluate: () => Promise.resolve({ kind: 'network-error' }) };
    const html = renderToStaticMarkup(<App access={{ status: 'ready', evaluator, accountLabel: 'demo-judge' }} now={fixedNow} />);
    expect(runButton.exec(html)?.[1]).toBeUndefined();
    expect(html).toContain('demo-judge');
    expect(html).not.toContain('評価APIに未接続です');
  });

  it('offers all five input presets and explains that weather and results come from the backend', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: [] }} now={fixedNow} />);
    for (const preset of CONSOLE_PRESETS) expect(html).toContain(`プリセット「${preset.label}」を読み込む`);
    expect(html).toContain('予定との時間差を保って入力欄を埋めます');
    expect(html).toContain('選んだ位置の実際の天気を使います');
    expect(html).toContain('雨や推薦の発生は保証されません');
    expect(html).not.toContain('recommendation-card');
  });

  it('initializes the editor at the injected current minute instead of a fixed fixture date', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: [] }} now={() => new Date('2026-10-02T05:25:59.999Z')} />);
    expect(html).toContain('value="2026-10-02T14:25"');
    expect(html).toContain('送信値: 2026-10-02T14:25:00+09:00');
    expect(html).not.toContain('2026-10-01T14:10');
  });
});
