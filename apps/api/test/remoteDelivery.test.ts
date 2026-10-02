import { describe, expect, it, vi } from 'vitest';
import type { DeliveryIntent, StateRepository } from '@contextia/providers';
import { createRemoteDelivery } from '../src/application/remoteDelivery.js';
import { NOW, ok, record } from './support/repository.js';

describe('immutable remote delivery intent', () => {
  function setup(path: 'client' | 'remote' = 'remote') {
    let intent: DeliveryIntent = path === 'client' ? { path: 'client', status: 'ready' } : { path: 'remote', status: 'reserved' };
    const state = {
      getRecommendation: vi.fn(async () => ok(record)),
      listDevices: vi.fn(async () => ok([{ deviceId: 'd1', platform: 'ios' as const, provider: 'expo' as const, token: 'private-token', enabled: true, lastSeenAt: NOW.toISOString() }])),
      getDeliveryIntent: vi.fn(async () => ok(intent)),
      claimRemoteDelivery: vi.fn<StateRepository['claimRemoteDelivery']>(async () => {
        if (intent.path !== 'remote' || intent.status !== 'reserved') return ok(false);
        intent = { path: 'remote', status: 'claimed' }; return ok(true);
      }),
      completeRemoteDelivery: vi.fn<StateRepository['completeRemoteDelivery']>(async input => { intent = { path: 'remote', status: input.status }; return ok(null); })
    };
    const expo = { send: vi.fn(async () => ok({ receiptId: 'accepted' })) };
    const sns = { send: vi.fn(async () => ok({ receiptId: 'sns-accepted' })) };
    return { state, expo, sns, send: createRemoteDelivery({ state, providers: { expo, sns }, provider: 'expo', clock: () => NOW, newClaimId: () => 'claim-1' }) };
  }
  it('claims once before external send under concurrent attempts and selects one adapter', async () => {
    const { send, state, expo, sns } = setup();
    const results = await Promise.all([send({ userId: 'owner', recommendationId: record.id }), send({ userId: 'owner', recommendationId: record.id })]);
    expect(results).toContain('sent'); expect(expo.send).toHaveBeenCalledOnce(); expect(sns.send).not.toHaveBeenCalled();
    expect(state.claimRemoteDelivery.mock.invocationCallOrder[0]).toBeLessThan(expo.send.mock.invocationCallOrder[0]!);
    expect(await send({ userId: 'owner', recommendationId: record.id })).toBe('sent');
    expect(expo.send).toHaveBeenCalledOnce();
  });
  it('never converts a ready client path into remote delivery', async () => {
    const { send, expo } = setup('client');
    expect(await send({ userId: 'owner', recommendationId: record.id })).toBe('ready');
    expect(expo.send).not.toHaveBeenCalled();
  });
  it('does not send if storage fails, or resend after provider uncertainty/failure', async () => {
    const { send, state, expo } = setup();
    state.claimRemoteDelivery.mockResolvedValueOnce({ status: 'error', data: null, code: 'STORAGE_ERROR' });
    await expect(send({ userId: 'owner', recommendationId: record.id })).rejects.toThrow(); expect(expo.send).not.toHaveBeenCalled();
    expo.send.mockRejectedValueOnce(new Error('private-upstream-message'));
    expect(await send({ userId: 'owner', recommendationId: record.id })).toBe('failed');
    expect(await send({ userId: 'owner', recommendationId: record.id })).toBe('failed'); expect(expo.send).toHaveBeenCalledOnce();
  });
  it('keeps the claim irreversible when the provider accepted but completion storage failed', async () => {
    const { send, state, expo } = setup();
    state.completeRemoteDelivery.mockResolvedValueOnce({ status: 'error', data: null, code: 'TIMEOUT' });
    await expect(send({ userId: 'owner', recommendationId: record.id })).rejects.toThrow();
    expect(await send({ userId: 'owner', recommendationId: record.id })).toBe('failed');
    expect(expo.send).toHaveBeenCalledOnce();
  });
});
