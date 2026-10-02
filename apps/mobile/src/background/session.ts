import { parseStoredSession, type StoredSession } from '../auth/sessionModel';

export function backgroundSessionIdentity(session: StoredSession): string { return session.refreshToken ?? session.accessToken; }
/** Headless execution never refreshes or writes credentials. It skips expired/locked sessions. */
export async function createBackgroundSession(options: {
  read: () => Promise<StoredSession | null>; enabled: (identity: string) => Promise<boolean>; now: () => number;
}): Promise<{ getAccessToken: () => Promise<string | null>; isCurrent: () => Promise<boolean> } | null> {
  try {
    const first = parseStoredSession(await options.read());
    if (!first) return null;
    const identity = backgroundSessionIdentity(first);
    const fresh = (session: StoredSession | null) => session && backgroundSessionIdentity(session) === identity && session.expiresAtEpochSeconds > options.now() + 30;
    const getAccessToken = async () => {
      try {
        const before = parseStoredSession(await options.read());
        if (!fresh(before) || !await options.enabled(identity)) return null;
        const current = parseStoredSession(await options.read());
        return fresh(current) ? current?.accessToken ?? null : null;
      } catch { return null; }
    };
    if (!await getAccessToken()) return null;
    return { getAccessToken, isCurrent: async () => await getAccessToken() !== null };
  } catch { return null; }
}
