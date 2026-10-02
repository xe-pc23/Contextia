import type { z } from 'zod';
import {
  ContextEvaluateResponseSchema, ErrorResponseSchema, EvaluationHeadersSchema, GetMeResponseSchema,
  GetRecommendationResponseSchema, ListRecommendationsResponseSchema,
  RealContextInputSchema, RecommendationParamsSchema, RecommendationsQuerySchema,
  UpdatePreferencesRequestSchema, UpdatePreferencesResponseSchema
} from '@contextia/contracts';
import type {
  ContextEvaluateResponse, GetMeResponse, GetRecommendationResponse,
  ListRecommendationsResponse, UpdatePreferencesResponse
} from '@contextia/contracts';

export type BackendFailure =
  | { kind: 'invalid-request'; fields: string[] }
  | { kind: 'unauthenticated' }
  | { kind: 'http-error'; status: number; code: string; requestId: string | null }
  | { kind: 'invalid-response' }
  | { kind: 'network-error' }
  | { kind: 'timeout' }
  | { kind: 'cancelled' };

export type BackendOutcome<T> = { kind: 'success'; requestId: string; data: T } | BackendFailure;

export interface BackendClient {
  getProfile(signal?: AbortSignal): Promise<BackendOutcome<GetMeResponse['data']>>;
  updatePreferences(input: unknown, signal?: AbortSignal): Promise<BackendOutcome<UpdatePreferencesResponse['data']>>;
  evaluate(input: unknown, signal?: AbortSignal): Promise<BackendOutcome<ContextEvaluateResponse['data']>>;
  listRecommendations(query?: unknown, signal?: AbortSignal): Promise<BackendOutcome<ListRecommendationsResponse['data']>>;
  getRecommendation(id: string, signal?: AbortSignal): Promise<BackendOutcome<GetRecommendationResponse['data']>>;
}

export function apiBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (/\/v1\/?$/.test(url.pathname)) return null;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
  } catch {
    return null;
  }
}

function invalidFields(issues: readonly { path: readonly PropertyKey[] }[]): BackendFailure {
  return { kind: 'invalid-request', fields: issues.slice(0, 20).map(issue => issue.path.map(String).join('.')) };
}

export function createBackendClient(options: {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  createIdempotencyKey: () => string;
  getSessionSignal?: () => AbortSignal;
  onUnauthorized?: (accessToken: string, sessionSignal: AbortSignal | undefined) => Promise<void>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): BackendClient {
  const parsedBase = apiBaseUrl(options.baseUrl);
  if (!parsedBase) throw new Error('API base URL must be HTTPS and omit /v1');
  const base = new URL(parsedBase);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid API timeout');
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(
    path: string,
    schema: z.ZodType<{ requestId: string; data: T }>,
    method: 'GET' | 'PUT' | 'POST',
    signal?: AbortSignal,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<BackendOutcome<T>> {
    const sessionSignal = options.getSessionSignal?.();
    if (signal?.aborted || sessionSignal?.aborted) return { kind: 'cancelled' };
    const controller = new AbortController();
    let stopped: BackendFailure | null = null;
    let stop: (failure: BackendFailure) => void = () => undefined;
    const interrupted = new Promise<BackendFailure>(resolve => {
      stop = failure => {
        if (stopped) return;
        stopped = failure;
        resolve(failure);
        controller.abort();
      };
    });
    const cancel = () => stop({ kind: 'cancelled' });
    signal?.addEventListener('abort', cancel, { once: true });
    sessionSignal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop({ kind: 'timeout' }), timeoutMs);

    const perform = async (): Promise<BackendOutcome<T>> => {
      let token: string | null;
      try { token = await options.getAccessToken(); } catch { token = null; }
      if (stopped) return stopped;
      if (!token || /[\r\n]/.test(token)) return { kind: 'unauthenticated' };
      const response = await fetchImpl(new URL(path, base).toString(), {
        method,
        headers: {
          accept: 'application/json', authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error'
      });
      if (stopped) return stopped;
      if (response.status === 401) {
        stop({ kind: 'unauthenticated' });
        await options.onUnauthorized?.(token, sessionSignal).catch(() => undefined);
        return { kind: 'unauthenticated' };
      }
      let raw: unknown;
      try { raw = await response.json(); } catch { raw = null; }
      if (stopped) return stopped;
      if (!response.ok) {
        const error = ErrorResponseSchema.safeParse(raw);
        return {
          kind: 'http-error', status: response.status,
          code: error.success && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.data.error.code) ? error.data.error.code : `HTTP_${response.status}`,
          requestId: error.success ? error.data.requestId : null
        };
      }
      const parsed = schema.safeParse(raw);
      return parsed.success
        ? { kind: 'success', requestId: parsed.data.requestId, data: parsed.data.data }
        : { kind: 'invalid-response' };
    };

    try {
      return await Promise.race([
        perform().catch((): BackendFailure => stopped ?? { kind: 'network-error' }), interrupted
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      sessionSignal?.removeEventListener('abort', cancel);
    }
  }

  return {
    getProfile: signal => request('v1/me', GetMeResponseSchema, 'GET', signal),
    async updatePreferences(input, signal) {
      const parsed = UpdatePreferencesRequestSchema.safeParse(input);
      return parsed.success
        ? request('v1/me/preferences', UpdatePreferencesResponseSchema, 'PUT', signal, parsed.data)
        : invalidFields(parsed.error.issues);
    },
    async evaluate(input, signal) {
      const parsed = RealContextInputSchema.safeParse(input);
      if (!parsed.success) return invalidFields(parsed.error.issues);
      if (parsed.data.preferencesOverride !== undefined || parsed.data.scenarioTime !== undefined) {
        return { kind: 'invalid-request', fields: ['preferencesOverride', 'scenarioTime'] };
      }
      let key: string;
      try { key = options.createIdempotencyKey(); }
      catch { return { kind: 'invalid-request', fields: ['idempotencyKey'] }; }
      const headers = EvaluationHeadersSchema.safeParse({ idempotencyKey: key });
      if (!headers.success || !headers.data.idempotencyKey) return { kind: 'invalid-request', fields: ['idempotencyKey'] };
      const result = await request('v1/context/evaluate', ContextEvaluateResponseSchema, 'POST', signal, parsed.data, {
        'Idempotency-Key': headers.data.idempotencyKey
      });
      if (result.kind === 'success' && result.data.delivery.mode !== 'proactive') return { kind: 'invalid-response' };
      return result;
    },
    async listRecommendations(query = {}, signal) {
      const parsed = RecommendationsQuerySchema.safeParse(query);
      if (!parsed.success) return invalidFields(parsed.error.issues);
      const search = new URLSearchParams({ limit: String(parsed.data.limit) });
      if (parsed.data.cursor) search.set('cursor', parsed.data.cursor);
      return request(`v1/recommendations?${search}`, ListRecommendationsResponseSchema, 'GET', signal);
    },
    async getRecommendation(id, signal) {
      const parsed = RecommendationParamsSchema.safeParse({ recommendationId: id });
      if (!parsed.success) return invalidFields(parsed.error.issues);
      const result = await request(`v1/recommendations/${encodeURIComponent(parsed.data.recommendationId)}`, GetRecommendationResponseSchema, 'GET', signal);
      return result.kind === 'success' && result.data.id !== id ? { kind: 'invalid-response' } : result;
    }
  };
}
