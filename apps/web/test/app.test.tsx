import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App.js';
import type { ScenarioEvaluator } from '../src/execution/scenarioApiClient.js';

const runButton = /<button type="button" class="primary"( disabled="")?[^>]*>シナリオを実行<\/button>/;

describe('Scenario Console shell', () => {
  it('states that the API is unconnected and blocks running', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: ['評価APIのURL', 'Cognitoログイン'] }} />);
    expect(html).toContain('評価APIに未接続です');
    expect(html).toContain('接続待ち: 評価APIのURL、Cognitoログイン');
    expect(runButton.exec(html)?.[1]).toBe(' disabled=""');
    expect(html).toContain('評価APIとログインが未接続のため実行できません');
    expect(html).not.toContain('recommendation-card');
  });

  it('starts from the step-goal preset inputs with preview delivery fixed', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: [] }} />);
    for (const value of ['35.681236', '139.767125', '2026-10-01T14:10', 'Asia/Tokyo', '10432', '10000', 'cafe, park']) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html).toContain('目標達成: 達成');
    expect(html).toContain('送信値: 2026-10-01T14:10:00+09:00');
    expect(html).toContain('deliveryMode=preview');
    expect(html).toContain('&quot;mode&quot;: &quot;simulation&quot;');
  });

  it('shows the map as unconnected instead of a fake map', () => {
    const html = renderToStaticMarkup(<App access={{ status: 'unconnected', pending: [] }} />);
    expect(html).toContain('地図（MapLibre + Amazon Location）は未接続です');
    expect(html).toContain('現在の座標 <strong>35.681236, 139.767125</strong>');
  });

  it('enables running once an evaluator is connected', () => {
    const evaluator: ScenarioEvaluator = { evaluate: () => Promise.resolve({ kind: 'network-error' }) };
    const html = renderToStaticMarkup(<App access={{ status: 'ready', evaluator, accountLabel: 'demo-judge' }} />);
    expect(runButton.exec(html)?.[1]).toBeUndefined();
    expect(html).toContain('demo-judge');
    expect(html).not.toContain('評価APIに未接続です');
  });
});
