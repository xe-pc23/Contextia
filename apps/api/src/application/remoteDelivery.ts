import type { NotificationProvider, StateRepository } from '@contextia/providers';
import { ApiFailure } from './apiFailure.js';

type Repository = Pick<StateRepository, 'getRecommendation' | 'getDeliveryIntent' | 'claimRemoteDelivery' | 'completeRemoteDelivery' | 'listDevices'>;
type Status = 'ready' | 'sent' | 'failed';
/** Trusted internal application command only. It cannot upgrade a client reservation. */
export function createRemoteDelivery(deps: {
  state: Repository; providers: Partial<Record<'expo' | 'sns', NotificationProvider>>; provider: 'expo' | 'sns';
  clock: () => Date; newClaimId: () => string;
}): (input: { userId: string; recommendationId: string }) => Promise<Status> {
  return async input => {
    const owned = { ...input, nowEpochSeconds: Math.floor(deps.clock().getTime() / 1000) };
    const intent = await deps.state.getDeliveryIntent(owned);
    if (intent.status !== 'ok' && intent.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    if (!intent.data) throw new ApiFailure('RECOMMENDATION_NOT_FOUND');
    if (intent.data.path === 'client') return 'ready';
    // Claimed includes an uncertain crash after provider acceptance; retry must never send again.
    if (intent.data.status !== 'reserved') return intent.data.status === 'sent' ? 'sent' : 'failed';
    const recommendation = await deps.state.getRecommendation(owned);
    const devices = await deps.state.listDevices({ userId: input.userId });
    if ((recommendation.status !== 'ok' && recommendation.status !== 'degraded') || (devices.status !== 'ok' && devices.status !== 'degraded')) throw new ApiFailure('STATE_UNAVAILABLE');
    if (!recommendation.data || recommendation.data.id !== input.recommendationId || recommendation.data.expiresAt <= owned.nowEpochSeconds) throw new ApiFailure('RECOMMENDATION_NOT_FOUND');
    const provider = deps.providers[deps.provider];
    const device = devices.data.filter(value => value.enabled && value.provider === deps.provider)
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || a.deviceId.localeCompare(b.deviceId))[0];
    const claimId = deps.newClaimId();
    const claim = await deps.state.claimRemoteDelivery({ ...owned, claimId, ...(device && provider ? { device } : {}) });
    if (claim.status !== 'ok' && claim.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    if (!claim.data) return 'failed';
    // One logical target per recommendation avoids multiple OS displays on a single installation.
    let status: 'sent' | 'failed' = 'failed';
    if (device && provider) {
      try {
        const result = await provider.send({ userId: input.userId, device, recommendationId: input.recommendationId, title: 'Contextia', body: recommendation.data.message });
        if (result.status === 'ok' || result.status === 'degraded') status = 'sent';
      } catch { /* No raw error, device token or recommendation text is logged. */ }
    }
    const completed = await deps.state.completeRemoteDelivery({ ...owned, claimId, status });
    if (completed.status !== 'ok' && completed.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    return status;
  };
}
