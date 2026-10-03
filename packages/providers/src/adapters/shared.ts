import type { ProviderResult } from '@contextia/contracts';

export class AdapterTimeoutError extends Error {
  constructor() {
    super('Provider request timed out');
    this.name = 'AdapterTimeoutError';
  }
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid provider timeout');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AdapterTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function available<T>(status: 'ok' | 'degraded', data: T, latencyMs: number, code?: string): ProviderResult<T> {
  return code === undefined
    ? { status, data, latencyMs }
    : { status, data, latencyMs, code };
}

export function unavailable<T>(status: 'unavailable' | 'timeout' | 'error', latencyMs: number, code: string): ProviderResult<T> {
  return { status, data: null, latencyMs, code };
}

export function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  if ('name' in error && typeof error.name === 'string') return error.name;
  if ('$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null
    && 'httpStatusCode' in error.$metadata && typeof error.$metadata.httpStatusCode === 'number') {
    return `HTTP_${error.$metadata.httpStatusCode}`;
  }
  return '';
}

export function mapAwsError(error: unknown): { status: 'timeout' | 'error'; code: string } {
  const name = errorName(error);
  if (name === 'AdapterTimeoutError' || name === 'TimeoutError' || name === 'AbortError') {
    return { status: 'timeout', code: 'TIMEOUT' };
  }
  if (name === 'ThrottlingException' || name === 'TooManyRequestsException' || name === 'HTTP_429') {
    return { status: 'error', code: 'THROTTLED' };
  }
  if (name === 'AccessDeniedException' || name === 'UnrecognizedClientException' || name === 'CredentialsProviderError') {
    return { status: 'error', code: 'UPSTREAM_AUTH' };
  }
  if (name === 'ValidationException' || name === 'BadRequestException') {
    return { status: 'error', code: 'UPSTREAM_VALIDATION' };
  }
  return { status: 'error', code: 'UPSTREAM_ERROR' };
}

export function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
