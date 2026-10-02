import { withTimeout } from '../async/withTimeout';
import { parseStoredSession, type StoredSession } from './sessionModel';

export interface SessionStore {
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export type SessionRefreshResult =
  | { kind: 'success'; session: StoredSession }
  | { kind: 'rejected' }
  | { kind: 'unavailable' };

/** Serializes credential writes and fences refresh/restore against sign-out. */
export class SessionManager {
  private session: StoredSession | null = null;
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  private refreshing: { generation: number; promise: Promise<string | null> } | null = null;
  private requests = new AbortController();

  constructor(private readonly options: {
    store: SessionStore;
    refresh: (session: StoredSession) => Promise<SessionRefreshResult>;
    now: () => number;
    onSessionChange: (signedIn: boolean) => void;
    refreshTimeoutMs?: number;
  }) {}

  private enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.writes.catch(() => undefined).then(write);
    this.writes = next;
    return next;
  }

  private fresh(session: StoredSession): boolean {
    const now = this.options.now();
    return Number.isFinite(now) && session.expiresAtEpochSeconds > Math.floor(now) + 30;
  }

  async restore(): Promise<void> {
    const generation = this.generation;
    const stored = await this.options.store.read();
    if (generation !== this.generation) return;
    this.session = parseStoredSession(stored);
    if (this.session && this.requests.signal.aborted) this.requests = new AbortController();
    await this.getAccessToken();
    if (generation === this.generation) this.options.onSessionChange(this.session !== null);
  }

  async accept(value: StoredSession): Promise<boolean> {
    const session = parseStoredSession(value);
    if (!session || !this.fresh(session)) throw new Error('Invalid token session');
    const generation = ++this.generation;
    this.requests.abort();
    this.requests = new AbortController();
    this.session = session;
    try {
      await this.enqueue(async () => {
        if (generation === this.generation) await this.options.store.write(session);
      });
    } catch {
      if (generation === this.generation) await this.clear().catch(() => undefined);
      throw new Error('Could not save token session');
    }
    if (generation !== this.generation) return false;
    this.options.onSessionChange(true);
    return true;
  }

  getAccessToken = async (): Promise<string | null> => {
    const session = this.session;
    if (!session) return null;
    if (this.fresh(session)) return session.accessToken;
    if (!session.refreshToken) {
      await this.clear().catch(() => undefined);
      return null;
    }
    const generation = this.generation;
    if (this.refreshing?.generation === generation) return this.refreshing.promise;

    const refresh = async (): Promise<string | null> => {
      try {
        let result: SessionRefreshResult;
        const refreshTokens = async (): Promise<SessionRefreshResult> => this.options.refresh(session);
        try { result = await withTimeout(refreshTokens(), this.options.refreshTimeoutMs ?? 12_000); }
        catch { return null; }
        if (generation !== this.generation) return null;
        if (result.kind === 'rejected') {
          await this.clear().catch(() => undefined);
          return null;
        }
        if (result.kind !== 'success') return null;
        const next = parseStoredSession(result.session);
        if (!next || !this.fresh(next)) return null;
        await this.enqueue(async () => {
          if (generation === this.generation) await this.options.store.write(next);
        });
        if (generation !== this.generation) return null;
        this.session = next;
        this.options.onSessionChange(true);
        return next.accessToken;
      } catch {
        if (generation === this.generation) await this.clear().catch(() => undefined);
        return null;
      } finally {
        if (this.refreshing?.generation === generation) this.refreshing = null;
      }
    };
    const promise = refresh();
    this.refreshing = { generation, promise };
    return promise;
  };

  sessionForRevocation(): StoredSession | null {
    return this.session === null ? null : { ...this.session };
  }

  getSessionSignal = (): AbortSignal => this.requests.signal;

  rejectAccessToken = async (token: string, signal: AbortSignal | undefined): Promise<void> => {
    if (signal !== this.requests.signal || token !== this.session?.accessToken) return;
    await this.clear();
  };

  async clear(): Promise<void> {
    this.generation++;
    this.requests.abort();
    this.session = null;
    this.refreshing = null;
    this.options.onSessionChange(false);
    await this.enqueue(() => this.options.store.clear());
  }

  /** Unmount cancels in-flight work while preserving the stored login. */
  deactivate(): void {
    this.generation++;
    this.requests.abort();
    this.session = null;
    this.refreshing = null;
  }
}
