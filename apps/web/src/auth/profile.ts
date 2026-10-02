import { ErrorResponseSchema, GetMeResponseSchema, UpdatePreferencesRequestSchema, UpdatePreferencesResponseSchema } from '@contextia/contracts';

export async function ensureWebProfile(baseUrl: string, token: string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<void> {
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const options: RequestInit = { headers, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) };
  const response = await fetchImpl(new URL('v1/me', base).toString(), options);
  const value: unknown = await response.json();
  if (response.ok) { GetMeResponseSchema.parse(value); return; }
  const failure = ErrorResponseSchema.safeParse(value);
  if (response.status !== 404 || !failure.success || failure.data.error.code !== 'PROFILE_NOT_FOUND') throw new Error('プロフィールを取得できません。再度ログインしてください。');
  const defaults = UpdatePreferencesRequestSchema.parse({ interests: ['cafe', 'park'], stepGoal: 10_000, notificationFrequency: 'normal', notificationsEnabled: true, locale: 'ja-JP', timezone: 'Asia/Tokyo' });
  const update = await fetchImpl(new URL('v1/me/preferences', base).toString(), {
    ...options, signal: AbortSignal.timeout(10_000), method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(defaults)
  });
  if (!update.ok) throw new Error('プロフィールを作成できません。もう一度お試しください。');
  const updated: unknown = await update.json();
  UpdatePreferencesResponseSchema.parse(updated);
}
