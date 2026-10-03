import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createSqliteClaimStore, type ClaimDatabase } from '../src/notifications/sqliteClaims';

it('atomically reserves concurrent IDs across two stores and bounds retained records', async () => {
  const db = new DatabaseSync(':memory:');
  const port: ClaimDatabase = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...params) => { const result = db.prepare(sql).run(...params); return { changes: Number(result.changes) }; }
  };
  try {
    const first = createSqliteClaimStore(port, 'dev.user-session');
    const second = createSqliteClaimStore(port, 'dev.user-session');
    expect(await Promise.all([first.claim('id', 200, 100), second.claim('id', 200, 100)])).toEqual([true, false]);
    expect(await createSqliteClaimStore(port, 'prod.user-session').claim('id', 200, 100)).toBe(true);
    for (let i = 1; i < 99; i++) expect(await first.claim(`id${i}`, 200, 100)).toBe(true);
    expect(await first.claim('overflow', 200, 100)).toBe(false);
    expect(await first.claim('new', 300, 200)).toBe(true);
    expect(await first.claim('already-expired', 200, 200)).toBe(false);
    expect(db.prepare('SELECT count(*) AS count FROM local_delivery_claims').get()?.['count']).toBe(1);
  } finally { db.close(); }
});
