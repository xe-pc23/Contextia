import { UserPreferencesSchema } from '@contextia/contracts';
import type { CalendarEventContext, EvaluationResult, UserPreferences, WeatherReading } from '@contextia/contracts';
import type { MobileFailure } from '../application/mobileController';
import { messagesFor, type Messages } from '../i18n/messages';

const japanese = messagesFor('ja');

export function failureMessage(failure: MobileFailure, t: Messages = japanese): string {
  const f = t.failures;
  switch (failure.kind) {
    case 'invalid-request': return f.invalidRequest;
    case 'unauthenticated': return f.unauthenticated;
    case 'invalid-response': return f.invalidResponse;
    case 'network-error': return f.networkError;
    case 'timeout': return f.timeout;
    case 'cancelled': return f.cancelled;
    case 'location-required': return f.locationRequired;
    case 'invalid-context': return f.invalidContext;
    case 'profile-required': return f.profileRequired;
    case 'http-error':
      if (failure.status === 401) return f.http401;
      if (failure.status === 403) return f.http403;
      if (failure.code === 'PROFILE_NOT_FOUND') return f.profileNotFound;
      if (failure.status === 404) return f.http404;
      if (failure.code === 'CHAT_LIMIT_REACHED') return f.chatLimit;
      if (failure.status === 429) return f.http429;
      if (failure.status === 503) return f.http503;
      return f.generic;
  }
}

export function formatTime(timestamp: string, timezone?: string, t: Messages = japanese): string {
  return new Intl.DateTimeFormat(t.intlLocale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(timezone === undefined ? {} : { timeZone: timezone })
  }).format(new Date(timestamp));
}

export function weatherPresentation(weather: WeatherReading | null | undefined, timezone?: string, t: Messages = japanese) {
  if (!weather) return { condition: t.weather.notFetched, temperature: t.common.notFetched, period: '' };
  return {
    condition: t.weather.conditions[weather.condition],
    temperature: weather.temperatureCelsius === null ? t.weather.temperatureUnknown : `${weather.temperatureCelsius}°C`,
    period: weather.source === 'forecast'
      ? t.weather.forecast(formatTime(weather.startAt, timezone, t), formatTime(weather.endAt, timezone, t))
      : t.weather.observed(formatTime(weather.sourceTimestamp, timezone, t))
  };
}

export function nextCalendarEvent(events: readonly CalendarEventContext[], now: Date): CalendarEventContext | null {
  return events.filter(event => !event.allDay && Date.parse(event.endAt) > now.getTime())
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0] ?? null;
}

export function evaluationPresentation(result: EvaluationResult, t: Messages = japanese) {
  return {
    title: result.decision === 'notify' ? t.dashboard.notifyTitle : t.dashboard.silentTitle,
    message: result.message,
    reason: result.decisionReason,
    cards: result.recommendations,
    signals: result.usedSignals.map(signal => t.signals[signal]),
    guards: result.delivery.guardCodes.map(code => t.guards[code])
  };
}

export type PreferencesDraft = {
  interests: string;
  stepGoal: string;
  notificationFrequency: UserPreferences['notificationFrequency'];
  notificationsEnabled: boolean;
  locale: string;
  timezone: string;
};
export function preferencesDraft(value: UserPreferences): PreferencesDraft {
  return { ...value, interests: value.interests.join(', '), stepGoal: String(value.stepGoal) };
}
export function parsePreferencesDraft(draft: PreferencesDraft) {
  return UserPreferencesSchema.safeParse({
    ...draft,
    interests: draft.interests.split(/[,、]/).map(value => value.trim()).filter(Boolean),
    stepGoal: /^\d+$/.test(draft.stepGoal.trim()) ? Number(draft.stepGoal.trim()) : Number.NaN,
    locale: draft.locale.trim(), timezone: draft.timezone.trim()
  });
}
