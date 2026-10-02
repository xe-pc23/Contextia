import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecommendationCards } from '../src/screens/components';

// Native rendering primitives are unavailable in Node; keep the real card logic.
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Primitive = ({ children }: { children: ReactNode }) => createElement('span', {}, children);
  return {
    Text: Primitive, View: Primitive,
    Button: ({ title }: { title: string }) => createElement('button', {}, title),
    StyleSheet: { create: <T,>(value: T) => value }, Linking: { openURL: async () => undefined }
  };
});

describe('Mobile recommendation cards', () => {
  it('keeps supplied route attribution text and its source action visible', () => {
    const html = renderToStaticMarkup(<RecommendationCards timezone="Asia/Tokyo" items={[{
      id: 'route-item', title: '移動', reason: '予定に間に合う経路', place: null,
      route: { mode: 'transit', durationMinutes: 12, attributions: [{ text: 'Transit data provider', url: 'https://example.com/source' }] },
      action: { type: 'NONE', url: null }
    }]} />);
    expect(html).toContain('Transit data provider');
    expect(html).toContain('提供元を開く');
  });
});
