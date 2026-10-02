import type { EvaluationResult, Profile, RecommendationHistoryItem } from '@contextia/contracts';
import type { ContextCollectionResult, RealContextInput } from '../../src/context/types';

export const profile: Profile = {
  userId: 'user-test',
  preferences: { interests: ['cafe'], stepGoal: 10000, notificationFrequency: 'normal', notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo' }
};
export const realInput: RealContextInput = {
  mode: 'real', deliveryMode: 'proactive', capturedAt: '2026-10-02T01:00:00Z',
  location: { latitude: 35.6812, longitude: 139.7671, capturedAt: '2026-10-02T01:00:00Z', source: 'gps' },
  activity: { stepsToday: null }, calendar: []
};
export const collection: ContextCollectionResult = {
  status: 'ready', input: realInput, permissions: { location: 'granted', calendar: 'granted', steps: 'unavailable' }
};
export const historyItem: RecommendationHistoryItem = {
  id: 'rec-test', createdAt: '2026-10-02T01:00:01Z', triggerType: 'FREE_TIME_NEARBY', message: '近くの場所を確認できます。',
  recommendations: [{ id: 'item-test', title: 'カフェ', reason: '空き時間に利用できます。', action: { type: 'NONE' } }]
};
const common = {
  evaluationId: 'eval-test', decisionReason: '現在の状況を確認しました。',
  usedSignals: ['location', 'calendar'] as EvaluationResult['usedSignals'],
  providerStatus: {
    places: { status: 'ok' as const }, weather: { status: 'unavailable' as const },
    routes: { status: 'not_requested' as const }, geocoding: { status: 'not_requested' as const }, bedrock: { status: 'ok' as const }
  },
  contextExpiresAt: '2026-10-03T01:00:00Z'
};
export const notify: EvaluationResult = {
  ...common, decision: 'notify', recommendationId: historyItem.id, triggerType: historyItem.triggerType,
  urgency: 'low', message: historyItem.message, recommendations: historyItem.recommendations,
  delivery: { mode: 'proactive', status: 'ready', wouldSuppress: false, guardCodes: [] }
};
export const silent: EvaluationResult = {
  ...common, decision: 'silent', recommendationId: null, triggerType: null, urgency: null, message: null, recommendations: [],
  delivery: { mode: 'proactive', status: 'suppressed', wouldSuppress: true, guardCodes: ['DUPLICATE_CONTEXT'] }
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
