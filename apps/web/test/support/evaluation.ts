import type { ApiRecommendationItem, EvaluationResult, ProviderStatusMap } from '@contextia/contracts';

// Synthetic API responses for client/UI tests only. The product path never
// renders these; it renders responses validated from the real API.

export type NotifyResult = Extract<EvaluationResult, { decision: 'notify' }>;
export type SilentResult = Extract<EvaluationResult, { decision: 'silent' }>;

export const providerStatus: ProviderStatusMap = {
  geocoding: { status: 'not_requested' },
  places: { status: 'ok', latencyMs: 210 },
  weather: { status: 'timeout', latencyMs: 2000, code: 'WEATHER_TIMEOUT' },
  routes: { status: 'not_requested' },
  bedrock: { status: 'ok', latencyMs: 1320 }
};

export function recommendationItem(index: number): ApiRecommendationItem {
  return {
    id: `item-${index}`,
    title: `休憩候補 ${index}`,
    reason: `候補 ${index} は現在地から近く、休憩に向いています。`,
    place: { provider: 'amazon-location', placeId: `place-${index}`, name: `テスト施設 ${index}`, latitude: 35.682, longitude: 139.768, distanceMeters: 150 * index },
    route: null,
    action: { type: 'MAP', url: `https://example.invalid/map/${index}` }
  };
}

export function notifyResult(count = 3): NotifyResult {
  return {
    evaluationId: 'eval-test-1',
    recommendationId: 'rec-test-1',
    decision: 'notify',
    decisionReason: 'Step goal reached and nearby rest options are available.',
    triggerType: 'STEP_GOAL_REST',
    urgency: 'low',
    message: '目標歩数を達成しました。近くで少し休憩しませんか？',
    recommendations: Array.from({ length: count }, (_, index) => recommendationItem(index + 1)),
    usedSignals: ['time', 'location', 'steps', 'places'],
    delivery: { mode: 'preview', status: 'preview', wouldSuppress: true, guardCodes: ['DUPLICATE_CONTEXT'] },
    providerStatus,
    contextExpiresAt: '2026-10-02T14:10:00+09:00'
  };
}

export function silentResult(): SilentResult {
  return {
    evaluationId: 'eval-test-2',
    recommendationId: null,
    decision: 'silent',
    decisionReason: 'No candidate is useful enough to interrupt the user.',
    triggerType: null,
    urgency: null,
    message: null,
    recommendations: [],
    usedSignals: [],
    delivery: { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: [] },
    providerStatus: {
      geocoding: { status: 'not_requested' }, places: { status: 'not_requested' }, weather: { status: 'not_requested' },
      routes: { status: 'not_requested' }, bedrock: { status: 'not_requested' }
    },
    contextExpiresAt: '2026-10-02T14:10:00+09:00'
  };
}

export function envelope(data: unknown, requestId = 'req-test-1'): { requestId: string; data: unknown } {
  return { requestId, data };
}
