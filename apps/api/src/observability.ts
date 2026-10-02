import type { ProviderResult } from '@contextia/contracts';
export type OperationMetric = {
  Stage: 'dev' | 'prod'; Provider: 'http' | 'evaluation' | 'places' | 'geocoding' | 'routes' | 'weather' | 'bedrock' | 'modelAttempt';
  Operation: 'request' | 'evaluate' | 'searchNearby' | 'getPlace' | 'geocode' | 'getRoute' | 'getWeather' | 'decide' | 'followUp' | 'initial' | 'fallback' | 'repair';
  Status: 'ok' | 'degraded' | 'unavailable' | 'error' | 'timeout' | 'not_requested'; Count: number; Errors: number; Latency: number;
};
export function createMetrics(stage: 'dev' | 'prod', emit: (entry: unknown) => void) {
  const record = (entry: Omit<OperationMetric, 'Stage'>) => {
    try { emit({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: 'Contextia', Dimensions: [['Stage', 'Provider', 'Operation', 'Status']], Metrics: [{ Name: 'Count', Unit: 'Count' }, { Name: 'Errors', Unit: 'Count' }, { Name: 'Latency', Unit: 'Milliseconds' }] }] }, Stage: stage, ...entry }); }
    catch { /* Metric transport is not a dependency for application correctness. */ }
  };
  return {
    record,
    async provider<T>(provider: OperationMetric['Provider'], operation: OperationMetric['Operation'], run: () => Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
      const started = performance.now(); let status: OperationMetric['Status'] = 'error';
      try { const result = await run(); status = result.status; return result; }
      finally { record({ Provider: provider, Operation: operation, Status: status, Count: 1, Errors: ['error', 'timeout', 'unavailable'].includes(status) ? 1 : 0, Latency: Math.round(performance.now() - started) }); }
    }
  };
}
