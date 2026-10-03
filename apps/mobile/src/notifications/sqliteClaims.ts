import type { LocalClaimStore } from './localDelivery';

export interface ClaimDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<{ changes: number }>;
}
/** SQLite's primary key arbitrates across separate foreground/headless runtimes. */
export function createSqliteClaimStore(database: ClaimDatabase, namespace: string): LocalClaimStore {
  let initialized: Promise<void> | undefined;
  return {
    async claim(id, expiresAt, now) {
      if (!id || !Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
      await (initialized ??= database.execAsync('CREATE TABLE IF NOT EXISTS local_delivery_claims (namespace TEXT NOT NULL, id TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (namespace, id))'));
      await database.runAsync('DELETE FROM local_delivery_claims WHERE expires <= ?', now);
      const result = await database.runAsync(
        'INSERT OR IGNORE INTO local_delivery_claims (namespace, id, expires) SELECT ?, ?, ? WHERE (SELECT count(*) FROM local_delivery_claims) < 100',
        namespace, id, expiresAt
      );
      return result.changes === 1;
    }
  };
}
