import { describe, expect, it, vi } from 'vitest';
import { SessionManager, type SessionRefreshResult, type SessionStore } from '../src/auth/sessionManager';
import type { StoredSession } from '../src/auth/sessionModel';
import { deferred } from './support/data';

const session: StoredSession = { accessToken: 'test-access', refreshToken: 'test-refresh', expiresAtEpochSeconds: 1000 };
function setup(refresh: (value: StoredSession) => Promise<SessionRefreshResult> = async value => ({ kind: 'success', session: { ...value, accessToken: 'refreshed-access', expiresAtEpochSeconds: 5000 } })) {
  let now = 100;
  let saved: StoredSession | null = session;
  const store: SessionStore = {
    read: vi.fn(async () => saved),
    write: vi.fn(async value => { saved = value; }),
    clear: vi.fn(async () => { saved = null; })
  };
  const changed = vi.fn<(value: boolean) => void>();
  const refreshCall = vi.fn(refresh);
  const manager = new SessionManager({ store, now: () => now, refresh: refreshCall, onSessionChange: changed, refreshTimeoutMs: 50 });
  return { manager, store, changed, refreshCall, saved: () => saved, setNow: (value: number) => { now = value; } };
}

describe('mobile session manager', () => {
  it('restores a fresh session without an unnecessary refresh', async () => {
    const test = setup();
    await test.manager.restore();
    expect(await test.manager.getAccessToken()).toBe(session.accessToken);
    expect(test.changed).toHaveBeenLastCalledWith(true);
    expect(test.refreshCall).not.toHaveBeenCalled();
  });
  it('refreshes at the 30-second boundary only once for concurrent calls', async () => {
    const pending = deferred<SessionRefreshResult>();
    const test = setup(() => pending.promise);
    await test.manager.restore(); test.setNow(970);
    const calls = [test.manager.getAccessToken(), test.manager.getAccessToken(), test.manager.getAccessToken()];
    expect(test.refreshCall).toHaveBeenCalledTimes(1);
    pending.resolve({ kind: 'success', session: { ...session, accessToken: 'new-access', expiresAtEpochSeconds: 5000 } });
    expect(await Promise.all(calls)).toEqual(['new-access', 'new-access', 'new-access']);
    expect(test.saved()?.accessToken).toBe('new-access');
  });
  it('does not restore credentials when a refresh finishes after logout', async () => {
    const pending = deferred<SessionRefreshResult>();
    const test = setup(() => pending.promise);
    await test.manager.restore(); test.setNow(1001);
    const token = test.manager.getAccessToken();
    const requests = test.manager.getSessionSignal();
    await test.manager.clear();
    expect(requests.aborted).toBe(true);
    pending.resolve({ kind: 'success', session: { ...session, expiresAtEpochSeconds: 5000 } });
    expect(await token).toBeNull();
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toBeNull();
    expect(test.changed).toHaveBeenLastCalledWith(false);
    expect(test.store.write).not.toHaveBeenCalled();
  });
  it('does not restore an old account when a delayed restore finishes after logout', async () => {
    const read = deferred<StoredSession | null>();
    const test = setup(); test.store.read = () => read.promise;
    const restoring = test.manager.restore();
    await test.manager.clear(); read.resolve(session); await restoring;
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.changed).toHaveBeenLastCalledWith(false);
  });
  it('serializes a pending credential write before the logout deletion', async () => {
    const test = setup();
    const writing = deferred<void>();
    const originalWrite = test.store.write;
    test.store.write = async value => { await writing.promise; await originalWrite(value); };
    const accepting = test.manager.accept(session);
    await Promise.resolve();
    const clearing = test.manager.clear();
    expect(await test.manager.getAccessToken()).toBeNull();
    writing.resolve();
    expect(await accepting).toBe(false);
    await clearing;
    expect(test.saved()).toBeNull();
  });
  it('keeps a newer login when an older refresh fails', async () => {
    const pending = deferred<SessionRefreshResult>();
    const test = setup(() => pending.promise);
    await test.manager.restore(); test.setNow(1001);
    const refreshing = test.manager.getAccessToken();
    await test.manager.accept({ ...session, accessToken: 'new-account-access', expiresAtEpochSeconds: 5000 });
    pending.resolve({ kind: 'rejected' });
    expect(await refreshing).toBeNull();
    expect(await test.manager.getAccessToken()).toBe('new-account-access');
    expect(test.saved()?.accessToken).toBe('new-account-access');
  });
  it('clears an expired session without a refresh token', async () => {
    const test = setup();
    await test.manager.accept({ accessToken: 'access-only', expiresAtEpochSeconds: 1000 });
    test.setNow(1001);
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toBeNull();
    expect(test.refreshCall).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'error', 'hang', 'invalid-response'])('preserves saved credentials without using an expired token when refresh is %s', async behavior => {
    const test = setup(async () => {
      if (behavior === 'error') throw new Error('private upstream failure');
      if (behavior === 'hang') return new Promise<SessionRefreshResult>(() => undefined);
      if (behavior === 'invalid-response') return { kind: 'success', session: { ...session, accessToken: '' } };
      return { kind: 'unavailable' };
    });
    await test.manager.restore(); test.setNow(1001);
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toEqual(session);
    expect(test.store.clear).not.toHaveBeenCalled();
    expect(test.manager.getSessionSignal().aborted).toBe(false);
    expect(test.changed).toHaveBeenLastCalledWith(true);
  });
  it('clears a session when the refresh adapter explicitly rejects its refresh token', async () => {
    const test = setup(async () => ({ kind: 'rejected' }));
    await test.manager.restore(); test.setNow(1001);
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toBeNull();
    expect(test.changed).toHaveBeenLastCalledWith(false);
  });
  it('can refresh again after a transient failure without signing in', async () => {
    const test = setup();
    await test.manager.restore(); test.setNow(1001);
    test.refreshCall.mockResolvedValueOnce({ kind: 'unavailable' });
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(await test.manager.getAccessToken()).toBe('refreshed-access');
    expect(test.saved()?.accessToken).toBe('refreshed-access');
  });
  it('restores a saved login during a transient refresh outage without exposing its expired token', async () => {
    const test = setup(async () => ({ kind: 'unavailable' })); test.setNow(1001);
    await test.manager.restore();
    expect(test.changed).toHaveBeenLastCalledWith(true);
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toEqual(session);
    test.refreshCall.mockResolvedValue({ kind: 'success', session: { ...session, accessToken: 'recovered-access', expiresAtEpochSeconds: 5000 } });
    expect(await test.manager.getAccessToken()).toBe('recovered-access');
  });
  it('preserves credentials when a refresh callback throws synchronously', async () => {
    const test = setup(() => { throw new Error('private transport error'); });
    await test.manager.restore(); test.setNow(1001);
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toEqual(session);
  });
  it('clears a current session on HTTP 401 and aborts other requests', async () => {
    const test = setup(); await test.manager.restore();
    const signal = test.manager.getSessionSignal();
    await test.manager.rejectAccessToken(session.accessToken, signal);
    expect(signal.aborted).toBe(true);
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toBeNull();
    expect(test.changed).toHaveBeenLastCalledWith(false);
  });
  it('keeps a newer login when an old request returns 401, even if both access tokens match', async () => {
    const test = setup(); await test.manager.restore();
    const oldSignal = test.manager.getSessionSignal();
    await test.manager.accept({ ...session, expiresAtEpochSeconds: 5000 });
    await test.manager.rejectAccessToken(session.accessToken, oldSignal);
    expect(await test.manager.getAccessToken()).toBe(session.accessToken);
    expect(test.saved()?.expiresAtEpochSeconds).toBe(5000);
    expect(test.store.clear).not.toHaveBeenCalled();
  });
  it('does not discard refreshed credentials when the rejected request used an older token', async () => {
    const test = setup(); await test.manager.restore(); test.setNow(1001);
    const signal = test.manager.getSessionSignal();
    expect(await test.manager.getAccessToken()).toBe('refreshed-access');
    await test.manager.rejectAccessToken(session.accessToken, signal);
    expect(await test.manager.getAccessToken()).toBe('refreshed-access');
    expect(test.store.clear).not.toHaveBeenCalled();
  });
  it('fails closed when a refreshed session cannot be saved', async () => {
    const test = setup(); await test.manager.restore(); test.setNow(1001);
    test.store.write = async () => { throw new Error('private storage failure'); };
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toBeNull();
    expect(test.changed).toHaveBeenLastCalledWith(false);
  });
  it('does not claim a signed-in session when storing it fails', async () => {
    const test = setup(); test.store.write = async () => { throw new Error('private storage failure'); };
    await expect(test.manager.accept(session)).rejects.toThrow('Could not save token session');
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toBeNull();
  });
  it('invalidates unmounted work without deleting a valid saved login', async () => {
    const test = setup(); await test.manager.restore(); test.manager.deactivate();
    expect(await test.manager.getAccessToken()).toBeNull();
    expect(test.saved()).toEqual(session);
    expect(test.store.clear).not.toHaveBeenCalled();
  });
});
