import { describe, expect, it, vi } from 'vitest';
import { MobileController } from '../src/application/mobileController';
import type { BackendClient, BackendOutcome } from '../src/api/backendClient';
import type { ContextCollectionResult } from '../src/context/types';
import type { EvaluationResult, RecommendationHistoryItem } from '@contextia/contracts';
import { collection, deferred, historyItem, notify, profile, silent } from './support/data';

function success<T>(data: T): BackendOutcome<T> { return { kind: 'success', requestId: 'req-test', data }; }
function setup() {
  const client = {
    getProfile: vi.fn<BackendClient['getProfile']>(async () => success(profile)),
    updatePreferences: vi.fn<BackendClient['updatePreferences']>(async () => success({ updated: true })),
    evaluate: vi.fn<BackendClient['evaluate']>(async () => success(notify)),
    listRecommendations: vi.fn<BackendClient['listRecommendations']>(async () => success({ items: [historyItem], nextCursor: null })),
    getRecommendation: vi.fn<BackendClient['getRecommendation']>(async () => success(historyItem))
  };
  const collect = vi.fn<(goal?: number) => Promise<ContextCollectionResult>>(async () => collection);
  const controller = new MobileController({ client, collector: { collect }, collectionTimeoutMs: 50 });
  return { client, collect, controller };
}

describe('foreground mobile workflow', () => {
  it('collects new context with the saved goal and shows notify/partial provider results', async () => {
    const test = setup(); await test.controller.loadProfile(); await test.controller.evaluate();
    expect(test.collect).toHaveBeenCalledWith(10000);
    expect(test.client.evaluate.mock.calls[0]?.[0]).toEqual(collection.status === 'ready' ? collection.input : null);
    expect(test.controller.getSnapshot().evaluation).toEqual({ status: 'ready', data: { result: notify, requestId: 'req-test' } });
    expect(test.controller.getSnapshot().evaluation.data?.result.providerStatus.weather.status).toBe('unavailable');
  });
  it('drops a previous notify when a new evaluation is silent', async () => {
    const test = setup(); await test.controller.evaluate();
    test.client.evaluate.mockResolvedValue(success(silent)); await test.controller.evaluate();
    expect(test.collect).toHaveBeenCalledTimes(2);
    expect(test.controller.getSnapshot().evaluation.data?.result).toEqual(silent);
  });
  it('prevents simultaneous evaluation and context collection', async () => {
    const pending = deferred<ContextCollectionResult>();
    const test = setup(); test.collect.mockReturnValue(pending.promise);
    const evaluating = test.controller.evaluate();
    await test.controller.evaluate(); await test.controller.readContext();
    expect(test.collect).toHaveBeenCalledTimes(1);
    expect(test.client.evaluate).not.toHaveBeenCalled();
    pending.resolve(collection); await evaluating;
    expect(test.client.evaluate).toHaveBeenCalledTimes(1);
  });
  it('never sends context without GPS permission', async () => {
    const test = setup(); test.collect.mockResolvedValue({ status: 'location-unavailable', location: 'denied', calendar: 'granted', steps: 'unavailable' });
    await test.controller.evaluate();
    expect(test.client.evaluate).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot().evaluation).toMatchObject({ status: 'error', error: { kind: 'location-required' } });
  });
  it('can evaluate when calendar permission is denied', async () => {
    const test = setup();
    if (collection.status !== 'ready') throw new Error('Fixture must be ready');
    test.collect.mockResolvedValue({ ...collection, permissions: { ...collection.permissions, calendar: 'denied' } });
    await test.controller.evaluate(); expect(test.client.evaluate).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging native collection without sending a late result', async () => {
    const test = setup(); const pending = deferred<ContextCollectionResult>();
    test.collect.mockReturnValue(pending.promise); await test.controller.evaluate();
    expect(test.controller.getSnapshot().evaluation).toMatchObject({ status: 'error', error: { kind: 'timeout' } });
    pending.resolve(collection); await Promise.resolve();
    expect(test.client.evaluate).not.toHaveBeenCalled();
  });
  it('disposes GPS/calendar data and aborts a pending evaluation on logout', async () => {
    const test = setup(); const pending = deferred<BackendOutcome<EvaluationResult>>();
    test.client.evaluate.mockReturnValue(pending.promise);
    const evaluating = test.controller.evaluate();
    await vi.waitFor(() => expect(test.client.evaluate).toHaveBeenCalledOnce());
    const signal = test.client.evaluate.mock.calls[0]?.[1];
    test.controller.dispose(); expect(signal?.aborted).toBe(true);
    pending.resolve(success(notify)); await evaluating;
    expect(test.controller.getSnapshot().collection).toBeNull();
    expect(test.controller.getSnapshot().evaluation.data).toBeNull();
    expect(test.client.listRecommendations).not.toHaveBeenCalled();
  });
  it('does not restore old results after reactivation', async () => {
    const test = setup(); const pending = deferred<BackendOutcome<EvaluationResult>>();
    test.client.evaluate.mockReturnValue(pending.promise); const evaluating = test.controller.evaluate();
    await vi.waitFor(() => expect(test.client.evaluate).toHaveBeenCalledOnce());
    test.controller.dispose(); test.controller.activate(); pending.resolve(success(notify)); await evaluating;
    expect(test.controller.getSnapshot().evaluation.status).toBe('idle');
  });
});

describe('profile, preferences and recommendation navigation', () => {
  it('updates the saved settings only after success and prevents duplicate saves', async () => {
    const test = setup(); await test.controller.loadProfile();
    const pending = deferred<BackendOutcome<{ updated: true }>>(); test.client.updatePreferences.mockReturnValue(pending.promise);
    const preferences = { ...profile.preferences, stepGoal: 12000, notificationsEnabled: false };
    const saving = test.controller.savePreferences(preferences); await test.controller.savePreferences(preferences);
    expect(test.client.updatePreferences).toHaveBeenCalledTimes(1);
    expect(test.controller.getSnapshot().profile.data?.preferences).toEqual(profile.preferences);
    pending.resolve(success({ updated: true })); await saving;
    expect(test.controller.getSnapshot().profile.data?.preferences).toEqual(preferences);
    expect(test.controller.getSnapshot().saveResult).toBe('saved');
  });
  it('preserves saved preferences on failure and validates before sending', async () => {
    const test = setup(); await test.controller.loadProfile();
    await test.controller.savePreferences({ ...profile.preferences, timezone: 'invalid-zone' });
    expect(test.client.updatePreferences).not.toHaveBeenCalled();
    test.client.updatePreferences.mockResolvedValue({ kind: 'http-error', status: 503, code: 'STATE_UNAVAILABLE', requestId: 'req-error' });
    await test.controller.savePreferences({ ...profile.preferences, stepGoal: 12000 });
    expect(test.controller.getSnapshot().profile.data?.preferences).toEqual(profile.preferences);
    expect(test.controller.getSnapshot().saveResult).toMatchObject({ kind: 'http-error', status: 503 });
  });
  it('does not create fabricated settings when profile retrieval fails', async () => {
    const test = setup(); test.client.getProfile.mockResolvedValue({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req-error' });
    await test.controller.loadProfile(); await test.controller.savePreferences(profile.preferences);
    expect(test.controller.getSnapshot().profile.data).toBeNull();
    expect(test.client.updatePreferences).not.toHaveBeenCalled();
  });
  it('discards an older detail response and aborts it when another ID is opened', async () => {
    const test = setup(); const older = deferred<BackendOutcome<RecommendationHistoryItem>>();
    test.client.getRecommendation.mockReturnValueOnce(older.promise).mockResolvedValueOnce(success({ ...historyItem, id: 'rec-new' }));
    const old = test.controller.openDetail('rec-test'); await test.controller.openDetail('rec-new');
    expect(test.client.getRecommendation.mock.calls[0]?.[1]?.aborted).toBe(true);
    older.resolve(success(historyItem)); await old;
    expect(test.controller.getSnapshot().detail.data?.id).toBe('rec-new');
    test.controller.closeDetail(); expect(test.controller.getSnapshot().detail.data).toBeNull();
  });
  it('shows a detail 404 as an error without displaying another item', async () => {
    const test = setup(); test.client.getRecommendation.mockResolvedValue({ kind: 'http-error', status: 404, code: 'NOT_FOUND', requestId: 'req-error' });
    await test.controller.openDetail('expired');
    expect(test.controller.getSnapshot().detail).toMatchObject({ status: 'error', data: null, error: { status: 404 } });
  });
  it('deduplicates history pages and stops a repeated cursor', async () => {
    const test = setup();
    test.client.listRecommendations.mockResolvedValueOnce(success({ items: [historyItem], nextCursor: 'next' }))
      .mockResolvedValueOnce(success({ items: [historyItem, { ...historyItem, id: 'rec-other' }], nextCursor: 'next' }));
    await test.controller.loadHistory(); await test.controller.loadHistory(true);
    expect(test.controller.getSnapshot().history.data?.items.map(item => item.id)).toEqual(['rec-test', 'rec-other']);
    expect(test.controller.getSnapshot().history.data?.nextCursor).toBeNull();
    expect(test.client.listRecommendations.mock.calls[1]?.[0]).toEqual({ cursor: 'next' });
  });
});
