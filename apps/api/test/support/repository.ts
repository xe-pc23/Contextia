import { vi } from 'vitest';
import type { ProviderResult, UserPreferences } from '@contextia/contracts';
import type { RecommendationRecord, StateRepository } from '@contextia/providers';
import { scenarios } from '@contextia/test-fixtures';
import { publicPlace } from '../../src/application/references.js';

export const NOW = new Date('2026-10-01T05:10:00.000Z');
export const preferences: UserPreferences = {
  interests: ['cafe'], stepGoal: 10_000, notificationFrequency: 'normal', notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo'
};
export const place = (() => {
  const value = scenarios.flatMap(scenario => scenario.providers.places.data ?? [])[0];
  if (!value) throw new Error('Missing test place');
  return value;
})();
export const record: RecommendationRecord = {
  id: 'rec-owned', evaluationId: 'eval-original', contextReference: { evaluationId: 'eval-original', capturedAt: NOW.toISOString() },
  createdAt: NOW.toISOString(), triggerType: 'STEP_GOAL_REST', urgency: 'low', message: 'A short rest.',
  recommendations: [{ id: 'item-original', title: place.name, reason: 'Nearby.', place: publicPlace(place), action: { type: 'MAP' } }],
  usedSignals: ['steps', 'places'], summaryForDedup: 'A short rest.',
  providerStatus: { geocoding: { status: 'not_requested' }, places: { status: 'ok' }, weather: { status: 'not_requested' }, routes: { status: 'not_requested' }, bedrock: { status: 'ok' } },
  expiresAt: Math.floor(NOW.getTime() / 1000) + 86400
};
export const ok = <T>(data: T): ProviderResult<T> => ({ status: 'ok', data });

export function repository() {
  let storedPreferences = preferences;
  return {
    getProfile: vi.fn<StateRepository['getProfile']>(async ({ userId }) => ok({ userId, preferences: storedPreferences })),
    putPreferences: vi.fn<StateRepository['putPreferences']>(async ({ preferences: value }) => { storedPreferences = value; return ok(null); }),
    getState: vi.fn<StateRepository['getState']>(async () => ok(null)),
    writeContextSnapshot: vi.fn<StateRepository['writeContextSnapshot']>(async () => ok(null)),
    getContextSnapshot: vi.fn<StateRepository['getContextSnapshot']>(async () => ok(null)),
    listRecommendations: vi.fn<StateRepository['listRecommendations']>(async () => ok({ items: [], nextCursor: null })),
    getRecommendation: vi.fn<StateRepository['getRecommendation']>(async ({ userId, recommendationId }) => ok(userId === 'user-1' && recommendationId === record.id ? record : null)),
    writeRecommendation: vi.fn<StateRepository['writeRecommendation']>(async () => ok(null)),
    commitProactiveRecommendation: vi.fn<StateRepository['commitProactiveRecommendation']>(async () => ok({ recorded: true })),
    claimIdempotency: vi.fn<StateRepository['claimIdempotency']>(async () => ok({ status: 'claimed' })),
    completeIdempotency: vi.fn<StateRepository['completeIdempotency']>(async () => ok(null)),
    getIdempotencyResponse: vi.fn<StateRepository['getIdempotencyResponse']>(async () => ok(null)),
    getConversation: vi.fn<StateRepository['getConversation']>(async () => ok(null)),
    appendConversationTurn: vi.fn<StateRepository['appendConversationTurn']>(async input => ok({
      recommendationId: input.recommendationId, conversationId: input.conversationId, turnCount: 1, expiresAt: input.expiresAt, messages: []
    }))
  };
}
