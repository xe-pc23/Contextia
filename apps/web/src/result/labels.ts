import type { GuardCode, ProviderStatusMap, ProviderStatusValue, RouteMode, SignalName, TriggerType, Urgency } from '@contextia/contracts';

export const triggerLabels: Readonly<Record<TriggerType, string>> = {
  UPCOMING_EVENT_TRANSIT: '予定前の移動',
  STEP_GOAL_REST: '歩数目標達成後の休憩',
  FREE_TIME_NEARBY: '空き時間の近場提案',
  WEATHER_ADAPTATION: '天気に合わせた調整',
  EARLY_ARRIVAL_DETOUR: '早く着いたときの寄り道'
};

export const signalLabels: Readonly<Record<SignalName, string>> = {
  time: '時刻', location: '現在地', calendar: '予定', steps: '歩数',
  weather: '天気', places: '周辺施設', transit: '交通経路', preferences: '好み'
};

export type ProviderKey = keyof ProviderStatusMap;
export const providerOrder: readonly ProviderKey[] = ['geocoding', 'places', 'weather', 'routes', 'bedrock'];
export const providerLabels: Readonly<Record<ProviderKey, string>> = {
  geocoding: 'ジオコーディング', places: '周辺施設（Places）', weather: '天気（Open-Meteo）',
  routes: '経路（Routes）', bedrock: 'AI判断（Bedrock）'
};

export const providerStatusLabels: Readonly<Record<ProviderStatusValue, string>> = {
  ok: '正常', degraded: '一部劣化', unavailable: '利用不可', timeout: 'タイムアウト', error: 'エラー', not_requested: '未使用'
};

export const guardCodeLabels: Readonly<Record<GuardCode, string>> = {
  NOTIFICATIONS_DISABLED: '通知がオフ',
  DAILY_CAP_REACHED: '1日の通知上限に到達',
  DUPLICATE_CONTEXT: '直前に同じ状況を評価済み',
  RECENT_SAME_TRIGGER: '直前に同じきっかけで通知済み',
  NO_CANDIDATE: '提案の候補なし',
  NO_MEANINGFUL_OPPORTUNITY: '通知する価値のある機会なし'
};

export const urgencyLabels: Readonly<Record<Urgency, string>> = { low: '低', medium: '中', high: '高' };

export const routeModeLabels: Readonly<Record<RouteMode, string>> = { transit: '公共交通', intermodal: '複合交通', pedestrian: '徒歩' };
