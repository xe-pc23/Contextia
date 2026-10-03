import { expect, it } from 'vitest';
import { BackgroundEvaluation, latestCallbackLocation } from '../src/background/evaluate';
import { collection, notify, profile } from './support/data';

const now = new Date('2026-10-03T00:30:00Z');
function setup() {
  const delivered: unknown[] = []; const evaluated: unknown[] = [];
  let current = true;
  const options = {
    isCurrent: async () => current,
    profile: async () => ({ kind: 'success' as const, requestId: 'req', data: profile }),
    collect: async () => collection,
    evaluate: async (input: unknown) => { evaluated.push(input); return { kind: 'success' as const, requestId: 'req', data: notify }; },
    deliver: async (value: unknown) => { delivered.push(value); }
  };
  return { options, evaluated, delivered, revoke: () => { current = false; } };
}
it('uses only the newest valid callback location and rejects stale/future or malformed fixes', () => {
  const fix = { coords: { latitude: 35, longitude: 139, accuracy: 10, privateField: 'ignored' }, timestamp: now.getTime() - 1000 };
  expect(latestCallbackLocation({ locations: [fix, { ...fix, timestamp: now.getTime() - 2000 }] }, now)).toEqual({ latitude: 35, longitude: 139, accuracyMeters: 10, capturedAt: new Date(fix.timestamp).toISOString(), source: 'gps' });
  expect(latestCallbackLocation({ locations: [{ ...fix, timestamp: now.getTime() + 1000 }] }, now)).toBeNull();
  expect(latestCallbackLocation({ locations: [{ ...fix, timestamp: now.getTime() - 11 * 60_000 }] }, now)).toBeNull();
  expect(latestCallbackLocation({ locations: [{ ...fix, coords: { latitude: 91, longitude: 139 } }] }, now)).toBeNull();
});
it('uses the same proactive evaluation and only delivers a background client result', async () => {
  const test = setup(); await new BackgroundEvaluation(test.options).run();
  expect(test.evaluated).toEqual([collection.status === 'ready' ? collection.input : null]); expect(test.delivered).toEqual([notify]);
});
it('serializes callbacks and discards the queued callback after opt-out', async () => {
  const test = setup(); let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const worker = new BackgroundEvaluation({ ...test.options, collect: async () => { await pending; return collection; } });
  const first = worker.run(); const second = worker.run();
  test.revoke(); release(); await Promise.all([first, second]);
  expect(test.evaluated).toEqual([]); expect(test.delivered).toEqual([]);
});
it('does not initialize an absent profile, bypass disabled preferences or evaluate denied location', async () => {
  const test = setup();
  await new BackgroundEvaluation({ ...test.options, profile: async () => ({ kind: 'http-error', status: 404, code: 'PROFILE_NOT_FOUND', requestId: null }) }).run();
  await new BackgroundEvaluation({ ...test.options, profile: async () => ({ kind: 'success', requestId: 'req', data: { ...profile, preferences: { ...profile.preferences, notificationsEnabled: false } } }) }).run();
  await new BackgroundEvaluation({ ...test.options, collect: async () => ({ status: 'location-unavailable', location: 'denied', calendar: 'unavailable', steps: 'unavailable' }) }).run();
  expect(test.evaluated).toEqual([]);
});
it('discards evaluation after logout and contains provider errors without retries', async () => {
  const test = setup();
  await new BackgroundEvaluation({ ...test.options, evaluate: async () => { test.revoke(); return { kind: 'success', requestId: 'req', data: notify }; } }).run();
  expect(test.delivered).toEqual([]);
  await new BackgroundEvaluation({ ...test.options, isCurrent: async () => true, profile: async () => { throw new Error('offline'); } }).run();
  expect(test.evaluated).toEqual([]);
});
