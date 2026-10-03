import type { ProviderResult, ProviderStatus } from '@contextia/contracts';

export function statusOf(result: ProviderResult<unknown>): ProviderStatus {
  return {
    status: result.status,
    ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
    ...(result.code === undefined ? {} : { code: result.code })
  };
}

/** Adapters own cancellation; this deadline also bounds injected or malfunctioning providers. */
export async function providerCall<T>(run: () => Promise<ProviderResult<T>>, timeoutMs: number): Promise<ProviderResult<T>> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ProviderResult<T>>(resolve => {
    timer = setTimeout(() => { resolve({ status: 'timeout', data: null, code: 'TIMEOUT' }); }, timeoutMs);
  });
  const call = Promise.resolve().then(run).catch((): ProviderResult<T> => ({ status: 'error', data: null, code: 'PROVIDER_EXCEPTION' }));
  try {
    const result = await Promise.race([call, timeout]);
    return { ...result, latencyMs: result.latencyMs ?? Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

export function mergeStatus(results: readonly ProviderResult<unknown>[]): ProviderStatus {
  if (!results.length) return { status: 'not_requested' };
  const usable = results.filter(result => result.status === 'ok' || result.status === 'degraded');
  const firstFailure = results.find(result => result.status !== 'ok');
  const latencyMs = Math.max(...results.map(result => result.latencyMs ?? 0));
  if (!firstFailure) return { status: 'ok', latencyMs };
  if (usable.length) return { status: 'degraded', latencyMs, code: firstFailure.code ?? 'PARTIAL_PROVIDER_RESULT' };
  return { ...statusOf(firstFailure), latencyMs };
}
