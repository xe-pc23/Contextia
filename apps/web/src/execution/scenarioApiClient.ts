import { ContextEvaluateResponseSchema, ErrorResponseSchema, OpaqueIdSchema, ScenarioContextInputSchema } from '@contextia/contracts';
import type { EvaluationResult, ScenarioContextInput } from '@contextia/contracts';

export const EVALUATE_PATH = 'v1/context/evaluate';
export const DEFAULT_EVALUATE_TIMEOUT_MS = 30_000;
const MAX_REPORTED_ISSUES = 20;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type IssueSummary = { readonly path: string; readonly message: string };

export type EvaluateFailure =
  /** The input failed the shared contract; nothing was sent. */
  | { readonly kind: 'invalid-request'; readonly issues: readonly IssueSummary[] }
  /** No access token is available; nothing was sent. */
  | { readonly kind: 'unauthenticated' }
  | {
    readonly kind: 'http-error'; readonly status: number; readonly requestId: string | null;
    readonly code: string; readonly message: string | null; readonly details: readonly IssueSummary[];
  }
  /** A 2xx body that does not satisfy the shared response contract is never displayed. */
  | { readonly kind: 'invalid-response'; readonly status: number; readonly requestId: string | null; readonly issues: readonly IssueSummary[] }
  | { readonly kind: 'network-error' }
  | { readonly kind: 'timeout'; readonly timeoutMs: number };

export type EvaluateOutcome =
  | { readonly kind: 'success'; readonly requestId: string; readonly result: EvaluationResult }
  | EvaluateFailure;

export interface ScenarioEvaluator {
  /** Resolves with an outcome for every failure; it does not reject. */
  evaluate(input: ScenarioContextInput): Promise<EvaluateOutcome>;
}

export interface ScenarioApiClientOptions {
  /** HTTP API origin (optionally with a base path), without `/v1`. */
  readonly baseUrl: string;
  /** Current Cognito access token, or null when signed out. */
  readonly getAccessToken: () => string | null | Promise<string | null>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Resolves the evaluate endpoint, rejecting non-HTTPS origins other than localhost. */
export function evaluateEndpoint(baseUrl: string): URL {
  const base = new URL(baseUrl);
  const secure = base.protocol === 'https:' || (base.protocol === 'http:' && LOCAL_HOSTS.has(base.hostname));
  if (!secure || base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') {
    throw new TypeError('API base URL must use HTTPS (HTTP only for localhost) without credentials, query or fragment');
  }
  if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
  return new URL(EVALUATE_PATH, base);
}

function summarize(issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]): IssueSummary[] {
  return issues.slice(0, MAX_REPORTED_ISSUES).map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message }));
}

function requestIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('requestId' in body)) return null;
  const parsed = OpaqueIdSchema.safeParse(body.requestId);
  return parsed.success ? parsed.data : null;
}

type JsonBody = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

async function readJson(response: Response): Promise<JsonBody> {
  const text = await response.text();
  if (text.trim() === '') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function interpret(status: number, ok: boolean, body: JsonBody): EvaluateOutcome {
  if (ok) {
    if (!body.ok) return { kind: 'invalid-response', status, requestId: null, issues: [{ path: '', message: 'Response body is not JSON' }] };
    const envelope = ContextEvaluateResponseSchema.safeParse(body.value);
    if (!envelope.success) return { kind: 'invalid-response', status, requestId: requestIdOf(body.value), issues: summarize(envelope.error.issues) };
    const { requestId, data } = envelope.data;
    if (data.delivery.mode !== 'preview') {
      return { kind: 'invalid-response', status, requestId, issues: [{ path: 'data.delivery.mode', message: 'Expected preview delivery for a Scenario Console request' }] };
    }
    return { kind: 'success', requestId, result: data };
  }
  const envelope = body.ok ? ErrorResponseSchema.safeParse(body.value) : null;
  if (envelope?.success) {
    const { requestId, error } = envelope.data;
    return { kind: 'http-error', status, requestId, code: error.code, message: error.message, details: error.details ?? [] };
  }
  return { kind: 'http-error', status, requestId: body.ok ? requestIdOf(body.value) : null, code: `HTTP_${status}`, message: null, details: [] };
}

/**
 * Client for `POST /v1/context/evaluate`. It accepts only simulation/preview
 * input and validates both the request and the response with the shared
 * contracts before anything is sent or displayed.
 */
export function createScenarioApiClient(options: ScenarioApiClientOptions): ScenarioEvaluator {
  const endpoint = evaluateEndpoint(options.baseUrl).toString();
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVALUATE_TIMEOUT_MS;

  return {
    async evaluate(input) {
      const parsed = ScenarioContextInputSchema.safeParse(input);
      if (!parsed.success) return { kind: 'invalid-request', issues: summarize(parsed.error.issues) };

      let token: string | null;
      try {
        token = await options.getAccessToken();
      } catch {
        token = null;
      }
      if (!token) return { kind: 'unauthenticated' };

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(parsed.data),
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error'
        });
        return interpret(response.status, response.ok, await readJson(response));
      } catch {
        return timedOut ? { kind: 'timeout', timeoutMs } : { kind: 'network-error' };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
