import { UserPreferencesSchema } from '@contextia/contracts';
import type { CalendarEventContext, EvaluationResult, GuardCode, SignalName, UserPreferences, WeatherReading } from '@contextia/contracts';
import type { MobileFailure } from '../application/mobileController';

export const signalLabels: Record<SignalName, string> = {
  time: '時刻', location: '現在地', calendar: '予定', steps: '歩数',
  weather: '天気', places: '周辺の場所', transit: '移動経路', preferences: '好み'
};
export const guardLabels: Record<GuardCode, string> = {
  NOTIFICATIONS_DISABLED: '通知を無効にしています', DAILY_CAP_REACHED: '今日の通知上限に達しました',
  DUPLICATE_CONTEXT: '直近に同じ状況を評価しました', RECENT_SAME_TRIGGER: '同じきっかけの提案をお知らせ済みです',
  NO_CANDIDATE: '提案のきっかけがありません', NO_MEANINGFUL_OPPORTUNITY: '今は新しい提案を控えます'
};

export function failureMessage(failure: MobileFailure): string {
  switch (failure.kind) {
    case 'invalid-request': return '入力内容を確認してください。';
    case 'unauthenticated': return '認証を確認できません。ネットワークを確認して、もう一度お試しください。';
    case 'invalid-response': return '応答を確認できませんでした。もう一度お試しください。';
    case 'network-error': return '接続できません。ネットワークを確認してください。';
    case 'timeout': return '処理に時間がかかっています。通信や端末の設定を確認して再実行してください。';
    case 'cancelled': return '処理を取り消しました。';
    case 'location-required': return '位置情報の許可と端末の GPS 設定を確認してください。';
    case 'invalid-context': return '端末の情報を確認できませんでした。もう一度読み取ってください。';
    case 'profile-required': return '設定を取得してから保存してください。';
    case 'http-error':
      if (failure.status === 401) return '認証の有効期限が切れました。サインアウトしてから再度サインインしてください。';
      if (failure.status === 403) return 'このアカウントまたはアプリでは実行できません。認証設定を確認してください。';
      if (failure.code === 'PROFILE_NOT_FOUND') return 'アカウントの設定がまだ用意されていません。';
      if (failure.status === 404) return 'データが見つかりません。保存期間の終了や接続先の準備状況を確認してください。';
      if (failure.status === 429) return 'リクエストが集中しています。少し待ってから再実行してください。';
      if (failure.status === 503) return 'サービスを現在利用できません。時間をおいて再実行してください。';
      return '処理に失敗しました。もう一度お試しください。';
  }
}

export function formatTime(timestamp: string, timezone?: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(timezone === undefined ? {} : { timeZone: timezone })
  }).format(new Date(timestamp));
}

export function weatherPresentation(weather: WeatherReading | null | undefined, timezone?: string) {
  if (!weather) return { condition: '天気は未取得', temperature: '未取得', period: '' };
  const labels = { clear: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪', storm: '荒天', unknown: '天候不明' };
  return {
    condition: labels[weather.condition],
    temperature: weather.temperatureCelsius === null ? '気温不明' : `${weather.temperatureCelsius}°C`,
    period: weather.source === 'forecast'
      ? `予報: ${formatTime(weather.startAt, timezone)}〜${formatTime(weather.endAt, timezone)}`
      : `観測: ${formatTime(weather.sourceTimestamp, timezone)}`
  };
}

export function nextCalendarEvent(events: readonly CalendarEventContext[], now: Date): CalendarEventContext | null {
  return events.filter(event => !event.allDay && Date.parse(event.endAt) > now.getTime())
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0] ?? null;
}

export function evaluationPresentation(result: EvaluationResult) {
  return {
    title: result.decision === 'notify' ? '今のあなたへの提案' : '今は提案を控えます',
    message: result.message,
    reason: result.decisionReason,
    cards: result.recommendations,
    signals: result.usedSignals.map(signal => signalLabels[signal]),
    guards: result.delivery.guardCodes.map(code => guardLabels[code])
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
