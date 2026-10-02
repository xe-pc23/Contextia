import { ProfileSchema, RecommendationHistoryItemSchema, UserPreferencesSchema } from '@contextia/contracts';
import type { Profile, RecommendationHistoryItem, RecommendationsQuery, UserPreferences } from '@contextia/contracts';
import type { RecommendationRecord, StateRepository } from '@contextia/providers';
import { ApiFailure } from './apiFailure.js';

export type AccountRepository = Pick<StateRepository, 'getProfile' | 'putPreferences' | 'listRecommendations' | 'getRecommendation'>;
export interface AccountServices {
  getMe(userId: string): Promise<Profile>;
  putPreferences(userId: string, preferences: UserPreferences, createOnly?: boolean): Promise<{ updated: true }>;
  listRecommendations(userId: string, query: RecommendationsQuery): Promise<{ items: RecommendationHistoryItem[]; nextCursor: string | null }>;
  getRecommendation(userId: string, recommendationId: string): Promise<RecommendationHistoryItem>;
}

function publicRecommendation(record: RecommendationRecord): RecommendationHistoryItem {
  return RecommendationHistoryItemSchema.parse({
    id: record.id, createdAt: record.createdAt, triggerType: record.triggerType,
    message: record.message, recommendations: record.recommendations
  });
}

export function createAccountServices(state: AccountRepository, clock: () => Date): AccountServices {
  return {
    async getMe(userId) {
      const result = await state.getProfile({ userId });
      if (result.status !== 'ok' && result.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
      if (!result.data) throw new ApiFailure('PROFILE_NOT_FOUND');
      if (result.data.userId !== userId) throw new ApiFailure('STATE_UNAVAILABLE');
      return ProfileSchema.parse(result.data);
    },
    async putPreferences(userId, preferences, createOnly) {
      const result = await state.putPreferences({ userId, preferences: UserPreferencesSchema.parse(preferences), at: clock().toISOString(), ...(createOnly ? { createOnly } : {}) });
      if (createOnly && result.status === 'error' && result.code === 'PROFILE_EXISTS') throw new ApiFailure('PROFILE_EXISTS');
      if (result.status !== 'ok' && result.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
      return { updated: true };
    },
    async listRecommendations(userId, query) {
      const nowEpochSeconds = Math.floor(clock().getTime() / 1000);
      const result = await state.listRecommendations({ userId, nowEpochSeconds, limit: query.limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) });
      if (result.status !== 'ok' && result.status !== 'degraded') {
        if (query.cursor && result.code === 'INVALID_REQUEST') throw new ApiFailure('INVALID_CURSOR');
        throw new ApiFailure('STATE_UNAVAILABLE');
      }
      return {
        items: result.data.items.filter(record => record.expiresAt > nowEpochSeconds).map(publicRecommendation),
        nextCursor: result.data.nextCursor
      };
    },
    async getRecommendation(userId, recommendationId) {
      const nowEpochSeconds = Math.floor(clock().getTime() / 1000);
      const result = await state.getRecommendation({ userId, nowEpochSeconds, recommendationId });
      if (result.status !== 'ok' && result.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
      if (!result.data || result.data.id !== recommendationId || result.data.expiresAt <= nowEpochSeconds) throw new ApiFailure('RECOMMENDATION_NOT_FOUND');
      return publicRecommendation(result.data);
    }
  };
}
