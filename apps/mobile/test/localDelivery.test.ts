import { expect, it } from 'vitest';
import { LocalDelivery } from '../src/notifications/localDelivery';
import { notify } from './support/data';

function setup() {
  const saved = new Set<string>();
  const displayed: string[] = [];
  const options = {
    store: { claim: async (id: string) => { if (saved.has(id)) return false; saved.add(id); return true; } },
    notify: async (value: { identifier: string }) => { displayed.push(value.identifier); },
    now: () => new Date('2026-10-03T00:30:00Z'), isCurrent: async () => true
  };
  return { options, displayed, saved: () => saved };
}
it('only schedules background client ready notifications, once across concurrent calls and restarts', async () => {
  const test = setup(); const delivery = new LocalDelivery(test.options);
  await Promise.all([delivery.deliver(notify, 'background'), delivery.deliver(notify, 'background')]);
  await new LocalDelivery(test.options).deliver(notify, 'background');
  expect(test.displayed).toEqual([`contextia-${notify.recommendationId}`]);
});
it('never locally displays foreground, preview, suppressed, sent or failed delivery', async () => {
  const test = setup(); const delivery = new LocalDelivery(test.options);
  await delivery.deliver(notify, 'foreground');
  for (const status of ['preview', 'suppressed', 'sent', 'failed']) {
    await delivery.deliver({ ...notify, delivery: { ...notify.delivery, status } }, 'background');
  }
  expect(test.displayed).toEqual([]); expect(test.saved().size).toBe(0);
});
it('reserves before scheduling and retains the claim after uncertain schedule failure', async () => {
  const test = setup(); const delivery = new LocalDelivery({ ...test.options, notify: async () => { expect(test.saved().has(notify.recommendationId ?? '')).toBe(true); throw new Error('OS uncertain'); } });
  expect(await delivery.deliver(notify, 'background')).toBe('failed');
  expect(await new LocalDelivery(test.options).deliver(notify, 'background')).toBe('duplicate');
  expect(test.displayed).toEqual([]);
});
it('fails closed on storage failure and revoked session', async () => {
  const test = setup();
  expect(await new LocalDelivery({ ...test.options, store: { claim: async () => { throw new Error('disk'); } } }).deliver(notify, 'background')).toBe('failed');
  expect(await new LocalDelivery({ ...test.options, isCurrent: async () => false }).deliver(notify, 'background')).toBe('skipped');
  expect(test.displayed).toEqual([]);
});
it('does not notify when logout happens after the durable claim', async () => {
  const test = setup(); let current = true;
  const delivery = new LocalDelivery({ ...test.options, isCurrent: async () => current, store: { claim: async () => { current = false; return true; } } });
  expect(await delivery.deliver(notify, 'background')).toBe('skipped'); expect(test.displayed).toEqual([]);
});
it('does not notify an expired evaluation or a malformed response', async () => {
  const test = setup(); const delivery = new LocalDelivery({ ...test.options, now: () => new Date('2026-10-03T01:00:00Z') });
  expect(await delivery.deliver(notify, 'background')).toBe('skipped');
  expect(await delivery.deliver({ recommendationId: 'bad' }, 'background')).toBe('skipped');
  expect(test.displayed).toEqual([]);
});
