import { z } from 'zod';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
function safeUrl(value: string, allowLocal = false): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || (allowLocal && url.protocol === 'http:' && localHosts.has(url.hostname)))
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
const httpsUrl = z.string().refine(value => safeUrl(value));
const ConfigSchema = z.strictObject({
  stage: z.enum(['dev', 'prod']), buildId: z.string().min(1), apiBaseUrl: httpsUrl,
  auth: z.strictObject({
    cognitoDomain: httpsUrl.refine(value => new URL(value).pathname === '/'),
    clientId: z.string().min(1), redirectUri: z.string(),
    scopes: z.array(z.enum(['openid', 'email', 'profile'])).min(1).refine(values => values.includes('openid'))
  }),
  map: z.strictObject({ region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/), styleName: z.enum(['Standard', 'Monochrome', 'Hybrid', 'Satellite']), apiKey: z.string().min(1) })
}).superRefine((config, context) => {
  if (!safeUrl(config.auth.redirectUri, config.stage === 'dev') || new URL(config.auth.redirectUri).pathname !== '/') {
    context.addIssue({ code: 'custom', path: ['auth', 'redirectUri'], message: 'Invalid callback URL' });
  }
});

export type WebConfig = z.infer<typeof ConfigSchema>;
export function parseWebConfig(value: unknown): WebConfig { return ConfigSchema.parse(value); }

export async function loadWebConfig(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<WebConfig> {
  try {
    const response = await fetchImpl('/config.json', { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Missing config');
    const value: unknown = await response.json();
    return parseWebConfig(value);
  } catch { throw new Error('設定を読み込めません。ページを再読み込みしてください。'); }
}

export function browserRedirectUri(config: WebConfig, origin: string): string {
  const expected = new URL(config.auth.redirectUri);
  if (expected.origin === origin) return config.auth.redirectUri;
  const local = new URL(origin);
  if (config.stage === 'dev' && localHosts.has(local.hostname) && safeUrl(origin, true)) return `${local.origin}/`;
  throw new Error('ログインの接続設定がこのページのURLと一致しません。');
}
