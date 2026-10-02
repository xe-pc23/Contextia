import { describe, expect, it, vi } from 'vitest';
import { MobileController } from '../src/application/mobileController';
import type { BackendClient, BackendOutcome } from '../src/api/backendClient';
import type { ContextCollectionResult } from '../src/context/types';
import type { ChatResponse, EvaluationResult, ListRecommendationsResponse, RecommendationHistoryItem } from '@contextia/contracts';
import { collection, deferred, historyItem, notify, profile, silent } from './support/data';

function success<T>(data: T): BackendOutcome<T> { return { kind: 'success', requestId: 'req-test', data }; }
function setup() {
  const client = {
    getProfile: vi.fn<BackendClient['getProfile']>(async () => success(profile)),
    updatePreferences: vi.fn<BackendClient['updatePreferences']>(async () => success({ updated: true })),
    evaluate: vi.fn<BackendClient['evaluate']>(async () => success(notify)),
    listRecommendations: vi.fn<BackendClient['listRecommendations']>(async () => success({ items: [historyItem], nextCursor: null })),
    getRecommendation: vi.fn<BackendClient['getRecommendation']>(async () => success(historyItem)),
    chat: vi.fn<BackendClient['chat']>(async () => success({ conversationId: 'chat-1', reply: 'A quiet place is nearby.', recommendations: [], expiresAt: new Date(Date.now() + 7200_000).toISOString() }))
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
  it('sends one follow-up and keeps the response within the opened detail', async () => {
    const test = setup();
    await test.controller.sendChat('No detail');
    expect(test.client.chat).not.toHaveBeenCalled();
    await test.controller.openDetail(historyItem.id);
    await test.controller.sendChat('Any quiet options?');
    expect(test.client.chat.mock.calls[0]?.slice(0, 2)).toEqual([historyItem.id, { message: 'Any quiet options?' }]);
    expect(test.controller.getSnapshot().chat.data?.reply).toBe('A quiet place is nearby.');
    test.controller.closeDetail();
    expect(test.controller.getSnapshot().chat.data).toBeNull();
  });
  it.each(['navigate', 'logout'])('aborts a pending chat on %s and discards its late reply', async action => {
    const test = setup(); const pending = deferred<BackendOutcome<ChatResponse['data']>>();
    await test.controller.openDetail(historyItem.id);
    test.client.chat.mockReturnValue(pending.promise);
    const sending = test.controller.sendChat('Any quiet options?');
    await test.controller.sendChat('Duplicate tap');
    const signal = test.client.chat.mock.calls[0]?.[2];
    expect(test.client.chat).toHaveBeenCalledOnce();
    if (action === 'logout') { test.controller.dispose(); test.controller.activate(); }
    else await test.controller.openDetail('rec-new');
    expect(signal?.aborted).toBe(true);
    pending.resolve(success({ conversationId: 'chat-old', reply: 'Old private reply', recommendations: [], expiresAt: new Date(Date.now() + 7200_000).toISOString() }));
    await sending;
    expect(test.controller.getSnapshot().chat.data).toBeNull();
  });
  it('keeps chat errors explicit and validates input before sending', async () => {
    const test = setup(); await test.controller.openDetail(historyItem.id);
    await test.controller.sendChat('x'.repeat(1001));
    expect(test.client.chat).not.toHaveBeenCalled();
    test.client.chat.mockResolvedValue({ kind: 'http-error', status: 404, code: 'RECOMMENDATION_NOT_FOUND', requestId: 'req' });
    await test.controller.sendChat('A question');
    expect(test.controller.getSnapshot().chat).toMatchObject({ status: 'error', data: null, error: { kind: 'http-error', status: 404 } });
  });
  it('refreshes history after evaluation even while the initial history request is pending', async () => {
    const test = setup();
    const initial = deferred<BackendOutcome<ListRecommendationsResponse['data']>>();
    const newest = { ...historyItem, id: 'rec-after-evaluation' };
    test.client.listRecommendations.mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(success({ items: [newest], nextCursor: 'fresh-cursor' }));
    const loading = test.controller.loadHistory();
    await test.controller.evaluate();
    expect(test.client.listRecommendations).toHaveBeenCalledTimes(1);
    initial.resolve(success({ items: [], nextCursor: null }));
    await loading;
    expect(test.client.listRecommendations).toHaveBeenCalledTimes(2);
    expect(test.controller.getSnapshot().history).toEqual({ status: 'ready', data: { items: [newest], nextCursor: 'fresh-cursor' } });
  });
  it('refreshes the first page after evaluation while a later page is loading', async () => {
    const test = setup();
    const page = deferred<BackendOutcome<ListRecommendationsResponse['data']>>();
    const newest = { ...historyItem, id: 'rec-after-evaluation' };
    test.client.listRecommendations.mockResolvedValueOnce(success({ items: [historyItem], nextCursor: 'old-cursor' }))
      .mockReturnValueOnce(page.promise)
      .mockResolvedValueOnce(success({ items: [newest], nextCursor: 'fresh-cursor' }));
    await test.controller.loadHistory();
    const loading = test.controller.loadHistory(true);
    await test.controller.evaluate();
    expect(test.client.listRecommendations).toHaveBeenCalledTimes(2);
    page.resolve(success({ items: [{ ...historyItem, id: 'older-page' }], nextCursor: 'older-cursor' }));
    await loading;
    expect(test.client.listRecommendations.mock.calls.map(([query]) => query)).toEqual([{}, { cursor: 'old-cursor' }, {}]);
    expect(test.controller.getSnapshot().history.data).toEqual({ items: [newest], nextCursor: 'fresh-cursor' });
  });
  it.each(['failure-result', 'exception'])('coalesces successful evaluations into one refresh after the current history request ends with %s', async behavior => {
    const test = setup();
    const initial = deferred<BackendOutcome<ListRecommendationsResponse['data']>>();
    const newest = { ...historyItem, id: 'rec-after-evaluations' };
    test.client.listRecommendations.mockImplementationOnce(async () => {
      const result = await initial.promise;
      if (behavior === 'exception') throw new Error('private network error');
      return result;
    })
      .mockResolvedValueOnce(success({ items: [newest], nextCursor: null }));
    const loading = test.controller.loadHistory();
    await test.controller.evaluate(); await test.controller.evaluate();
    expect(test.client.listRecommendations).toHaveBeenCalledTimes(1);
    initial.resolve({ kind: 'network-error' });
    await loading;
    expect(test.client.listRecommendations).toHaveBeenCalledTimes(2);
    expect(test.controller.getSnapshot().history).toEqual({ status: 'ready', data: { items: [newest], nextCursor: null } });
  });
  it('discards a queued history refresh on logout and does not disturb a reactivated session', async () => {
    const test = setup();
    const initial = deferred<BackendOutcome<ListRecommendationsResponse['data']>>();
    const current = { ...historyItem, id: 'rec-current-session' };
    test.client.listRecommendations.mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(success({ items: [current], nextCursor: null }));
    const loading = test.controller.loadHistory();
    await test.controller.evaluate();
    const oldSignal = test.client.listRecommendations.mock.calls[0]?.[1];
    test.controller.dispose();
    expect(oldSignal?.aborted).toBe(true);
    test.controller.activate();
    await test.controller.loadHistory();
    initial.resolve(success({ items: [historyItem], nextCursor: 'old-session-cursor' }));
    await loading;
    expect(test.client.listRecommendations).toHaveBeenCalledTimes(2);
    expect(test.controller.getSnapshot().history.data).toEqual({ items: [current], nextCursor: null });
  });
  it('does not queue a first-page refresh for repeated pagination taps', async () => {
    const test = setup();
    const page = deferred<BackendOutcome<ListRecommendationsResponse['data']>>();
    const older = { ...historyItem, id: 'older-page' };
    test.client.listRecommendations.mockResolvedValueOnce(success({ items: [historyItem], nextCursor: 'next-cursor' }))
      .mockReturnValueOnce(page.promise);
    await test.controller.loadHistory();
    const loading = test.controller.loadHistory(true);
    await test.controller.loadHistory(true); await test.controller.loadHistory(true);
    page.resolve(success({ items: [older], nextCursor: null }));
    await loading;
    expect(test.client.listRecommendations).toHaveBeenCalledTimes(2);
    expect(test.controller.getSnapshot().history.data?.items.map(item => item.id)).toEqual([historyItem.id, older.id]);
  });
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
    const test = setup(); test.client.getProfile.mockResolvedValue({ kind: 'http-error', status: 503, code: 'STATE_UNAVAILABLE', requestId: 'req-error' });
    await test.controller.loadProfile(); await test.controller.savePreferences(profile.preferences);
    expect(test.controller.getSnapshot().profile.data).toBeNull();
    expect(test.client.updatePreferences).not.toHaveBeenCalled();
  });
  it('initializes only a missing profile and displays the server result', async () => {
    const test = setup();
    const stored = { ...profile, preferences: { ...profile.preferences, stepGoal: 9000 } };
    test.client.getProfile.mockResolvedValueOnce({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req-missing' }).mockResolvedValueOnce(success(stored));
    await test.controller.loadProfile();
    expect(test.client.updatePreferences).toHaveBeenCalledOnce();
    expect(test.client.updatePreferences.mock.calls[0]?.[0]).toMatchObject({ interests: ['cafe', 'park'], stepGoal: 10000, timezone: 'Asia/Tokyo' });
    expect(test.client.updatePreferences.mock.calls[0]?.[2]).toBe(true);
    expect(test.controller.getSnapshot().profile).toEqual({ status: 'ready', data: stored });
  });
  it('reads the existing profile if another client wins the initial creation race', async () => {
    const test = setup();
    test.client.getProfile.mockResolvedValueOnce({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req' }).mockResolvedValueOnce(success(profile));
    test.client.updatePreferences.mockResolvedValue({ kind: 'http-error', status: 412, code: 'PROFILE_EXISTS', requestId: 'req' });
    await test.controller.loadProfile();
    expect(test.controller.getSnapshot().profile).toEqual({ status: 'ready', data: profile });
    expect(test.client.updatePreferences).toHaveBeenCalledOnce();
  });
  it.each(['created', 'existing'])('shows a failed read-back after initial profile %s without inventing settings', async outcome => {
    const test = setup();
    const failure = { kind: 'http-error' as const, status: 503, code: 'STATE_UNAVAILABLE', requestId: 'req' };
    test.client.getProfile.mockResolvedValueOnce({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req' }).mockResolvedValueOnce(failure);
    if (outcome === 'existing') test.client.updatePreferences.mockResolvedValue({ kind: 'http-error', status: 412, code: 'PROFILE_EXISTS', requestId: 'req' });
    await test.controller.loadProfile();
    expect(test.client.getProfile).toHaveBeenCalledTimes(2);
    expect(test.client.updatePreferences).toHaveBeenCalledOnce();
    expect(test.controller.getSnapshot().profile).toMatchObject({ status: 'error', data: null, error: failure });
  });
  it('does not treat another 412 error as an initial-profile race', async () => {
    const test = setup();
    const failure = { kind: 'http-error' as const, status: 412, code: 'OTHER_PRECONDITION', requestId: 'req' };
    test.client.getProfile.mockResolvedValue({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req' });
    test.client.updatePreferences.mockResolvedValue(failure);
    await test.controller.loadProfile();
    expect(test.client.getProfile).toHaveBeenCalledOnce();
    expect(test.client.updatePreferences).toHaveBeenCalledOnce();
    expect(test.controller.getSnapshot().profile).toMatchObject({ status: 'error', data: null, error: failure });
  });
  it.each([
    { kind: 'http-error' as const, status: 404, code: 'NOT_FOUND', requestId: 'req' },
    { kind: 'http-error' as const, status: 401, code: 'UNAUTHORIZED', requestId: 'req' },
    { kind: 'network-error' as const }, { kind: 'invalid-response' as const }
  ])('does not initialize on another profile failure: $kind', async failure => {
    const test = setup(); test.client.getProfile.mockResolvedValue(failure);
    await test.controller.loadProfile();
    expect(test.client.updatePreferences).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot().profile).toMatchObject({ status: 'error', data: null, error: failure });
  });
  it('shows failed initialization without inventing saved preferences or retrying', async () => {
    const test = setup();
    test.client.getProfile.mockResolvedValue({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req' });
    test.client.updatePreferences.mockResolvedValue({ kind: 'network-error' });
    await test.controller.loadProfile();
    expect(test.client.getProfile).toHaveBeenCalledOnce();
    expect(test.client.updatePreferences).toHaveBeenCalledOnce();
    expect(test.controller.getSnapshot().profile).toMatchObject({ status: 'error', data: null, error: { kind: 'network-error' } });
  });
  it('keeps one initialization in flight and blocks evaluation until it finishes', async () => {
    const test = setup(); const pending = deferred<BackendOutcome<typeof profile>>();
    test.client.getProfile.mockReturnValueOnce(pending.promise);
    const loading = test.controller.loadProfile(); await test.controller.loadProfile(); await test.controller.evaluate();
    expect(test.client.getProfile).toHaveBeenCalledOnce(); expect(test.collect).not.toHaveBeenCalled();
    pending.resolve(success(profile)); await loading;
  });
  it('does not initialize from an old missing-profile response after logout and reactivation', async () => {
    const test = setup(); const pending = deferred<BackendOutcome<typeof profile>>();
    test.client.getProfile.mockReturnValueOnce(pending.promise);
    const loading = test.controller.loadProfile(); test.controller.dispose(); test.controller.activate();
    pending.resolve({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req' }); await loading;
    expect(test.client.updatePreferences).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot().profile.status).toBe('idle');
  });
  it('does not read back or restore a profile after logout during initialization', async () => {
    const test = setup(); const pending = deferred<BackendOutcome<{ updated: true }>>();
    test.client.getProfile.mockResolvedValueOnce({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: 'req' });
    test.client.updatePreferences.mockReturnValue(pending.promise);
    const loading = test.controller.loadProfile();
    await vi.waitFor(() => expect(test.client.updatePreferences).toHaveBeenCalledOnce());
    test.controller.dispose(); test.controller.activate(); pending.resolve(success({ updated: true })); await loading;
    expect(test.client.getProfile).toHaveBeenCalledOnce(); expect(test.controller.getSnapshot().profile.status).toBe('idle');
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
