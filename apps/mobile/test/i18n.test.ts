import { describe, expect, it } from 'vitest';
import { languageForLocale, messagesFor, resolveLanguage } from '../src/i18n/messages';
import { evaluationPresentation, failureMessage, formatTime, weatherPresentation } from '../src/screens/presentation';
import { notify, silent } from './support/data';

function shape(value: unknown): unknown {
  if (typeof value === 'function') return 'function';
  if (typeof value !== 'object' || value === null) return typeof value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, shape(child)]));
}

describe('mobile UI language', () => {
  const en = messagesFor('en');

  it('provides the same keys in Japanese and English', () => {
    expect(shape(messagesFor('en'))).toEqual(shape(messagesFor('ja')));
  });
  it('uses Japanese only for ja locales and English otherwise', () => {
    expect(languageForLocale('ja-JP')).toBe('ja');
    expect(languageForLocale(' JA ')).toBe('ja');
    expect(languageForLocale('en-US')).toBe('en');
    expect(languageForLocale('fr-FR')).toBe('en');
    expect(languageForLocale(undefined)).toBe('en');
  });
  it('uses the profile locale, then the in-app choice, then Japanese, never the device language', () => {
    expect(resolveLanguage('en-US', 'ja')).toBe('en');
    expect(resolveLanguage('ja-JP', 'en')).toBe('ja');
    expect(resolveLanguage(undefined, 'en')).toBe('en');
    expect(resolveLanguage(undefined, null)).toBe('ja');
  });
  it('renders presentation text in English', () => {
    expect(failureMessage({ kind: 'http-error', status: 429, code: 'CHAT_LIMIT_REACHED', requestId: 'req' }, en)).toBe('You have reached the question limit for this suggestion.');
    expect(evaluationPresentation(notify, en)).toMatchObject({ title: 'Suggestions for you now', signals: ['Location', 'Calendar'] });
    expect(evaluationPresentation(silent, en).guards).toEqual(['The same situation was evaluated recently']);
    const weather = weatherPresentation({ source: 'forecast', condition: 'rain', temperatureCelsius: null,
      precipitationMillimeters: 1, precipitationProbability: 80, sourceTimestamp: '2026-10-01T05:00:00Z',
      startAt: '2026-10-01T06:00:00Z', endAt: '2026-10-01T07:00:00Z' }, 'Asia/Tokyo', en);
    expect(weather).toMatchObject({ condition: 'Rain', temperature: 'Temperature unknown' });
    expect(weather.period).toMatch(/^Forecast: .*3:00.*PM/);
    expect(formatTime('2026-10-01T06:00:00Z', 'Asia/Tokyo', en)).not.toMatch(/[぀-ヿ一-鿿]/);
  });
  it('keeps model and provider text untranslated', () => {
    expect(evaluationPresentation(notify, en)).toMatchObject({ message: notify.message, reason: notify.decisionReason, cards: notify.recommendations });
  });
});
