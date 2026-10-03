import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecommendationCards } from '../src/screens/components';
import { I18nProvider } from '../src/i18n/I18nContext';
import { messagesFor } from '../src/i18n/messages';

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
  it('labels route details and actions in English when the profile language is English', () => {
    const html = renderToStaticMarkup(<I18nProvider messages={messagesFor('en')}><RecommendationCards timezone="Asia/Tokyo" items={[{
      id: 'route-item', title: 'Head out', reason: 'A route that arrives on time', place: null,
      route: { mode: 'transit', durationMinutes: 12, transfers: 1, attributions: [{ text: 'Transit data provider', url: 'https://example.com/source' }] },
      action: { type: 'TRANSIT', url: 'https://example.com/route' }
    }]} /></I18nProvider>);
    expect(html).toContain('Travel time: 12 min / 1 transfer');
    expect(html).toContain('Open source');
    expect(html).toContain('Open route');
    expect(html).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
  });
});
