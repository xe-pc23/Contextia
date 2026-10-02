import { z } from 'zod';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import type { ChatLogProof } from './smoke-checks.js';

const RecordSchema = z.object({ _aws: z.object({ CloudWatchMetrics: z.array(z.object({ Namespace: z.literal('Contextia') })).min(1) }),
  Stage: z.literal('dev'), Count: z.number().positive(), Provider: z.string().optional(), Operation: z.string().optional(),
  Decision: z.enum(['notify', 'silent']).optional(), TriggerType: z.string().optional(), Latency: z.number().min(0).optional() });
const RequestRecordSchema = z.strictObject({ event: z.literal('http_request'), requestId: z.string().min(1),
  route: z.enum(['health', 'evaluate', 'me', 'preferences', 'recommendations', 'recommendation', 'chat', 'devices', 'delete-device', 'not-found']),
  statusCode: z.number().int().min(100).max(599), mode: z.enum(['real', 'simulation']).optional(), errorCode: z.string().optional() });
const EvidenceSchema = z.strictObject({ successRequestId: z.string().min(1), invalidRequestId: z.string().min(1),
  canaries: z.tuple([z.string().min(1), z.string().min(1)]), accessTokens: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)])
}).refine(evidence => evidence.successRequestId !== evidence.invalidRequestId && evidence.canaries[0] !== evidence.canaries[1]);

/** Lambda JSON logs wrap console output; TEXT logs prefix it with invocation metadata. */
function logRecord(message: string): unknown {
  let value: unknown;
  try {
    const text = message.replace(/^\d{4}-\d{2}-\d{2}T[^\t]+\t[^\t]+\t(?:INFO|WARN|ERROR|DEBUG)\t/, '');
    value = JSON.parse(text) as unknown;
    for (let depth = 0; depth < 2; depth++) {
      if (typeof value !== 'object' || value === null || Array.isArray(value) || 'event' in value || !('message' in value)) break;
      value = typeof value.message === 'string' ? JSON.parse(value.message) as unknown : value.message;
    }
    return value;
  } catch { return null; }
}
export function metricCoverage(messages: readonly string[]): boolean {
  const records = messages.flatMap(message => {
    const parsed = RecordSchema.safeParse(logRecord(message)); return parsed.success ? [parsed.data] : [];
  });
  return [['http', 'request'], ['evaluation', 'evaluate'], ['places', 'searchNearby'], ['modelAttempt', 'initial']].every(([provider, operation]) => records.some(record => record.Provider === provider && record.Operation === operation && record.Latency !== undefined))
    && records.some(record => record.Decision === 'notify' && record.TriggerType === 'STEP_GOAL_REST')
    && records.some(record => record.Decision === 'silent' && record.TriggerType === 'NONE');
}
/** Correlates two chat probes and scans a complete bounded dev log window in memory. */
export async function verifyDevMetrics(startTime: number, proof: ChatLogProof & { accessTokens: [string, string, string] }): Promise<void> {
  const checked = EvidenceSchema.safeParse(proof);
  const endTime = Date.now();
  if (!checked.success || !Number.isFinite(startTime) || startTime < 0 || startTime > endTime) throw new Error('Dev log evidence incomplete');
  const evidence = checked.data;
  const needles = [...evidence.canaries, ...evidence.accessTokens];
  const client = new CloudWatchLogsClient({ region: 'ap-northeast-1', maxAttempts: 2 });
  for (let attempt = 0; attempt < 4; attempt++) {
    const messages: string[] = []; let nextToken: string | undefined; const cursors = new Set<string>();
    let complete = false;
    for (let page = 0; page < 5; page++) {
      const result = await client.send(new FilterLogEventsCommand({ logGroupName: '/aws/lambda/contextia-dev-api', startTime, endTime,
        limit: 1000, ...(nextToken ? { nextToken } : {}) }));
      messages.push(...(result.events ?? []).flatMap(event => event.message ? [event.message] : []));
      if (!result.nextToken) { complete = true; break; }
      if (cursors.has(result.nextToken)) throw new Error('Dev log window incomplete');
      cursors.add(result.nextToken);
      nextToken = result.nextToken;
    }
    if (!complete) throw new Error('Dev log window incomplete');
    if (messages.some(message => needles.some(needle => message.includes(needle)))) throw new Error('Dev log privacy check failed');
    let successSeen = false; let invalidSeen = false;
    for (const message of messages) {
      const record = logRecord(message);
      if (typeof record !== 'object' || record === null || !('event' in record) || record.event !== 'http_request') continue;
      const request = RequestRecordSchema.safeParse(record);
      if (!request.success) throw new Error('Dev request log contains unexpected fields');
      const entry = request.data;
      if (entry.requestId === evidence.successRequestId && entry.route === 'chat' && entry.statusCode === 200 && !entry.errorCode && !entry.mode) successSeen = true;
      if (entry.requestId === evidence.invalidRequestId && entry.route === 'chat' && entry.statusCode === 400 && entry.errorCode === 'VALIDATION_ERROR' && !entry.mode) invalidSeen = true;
    }
    if (successSeen && invalidSeen && metricCoverage(messages)) return;
    if (attempt < 3) await new Promise<void>(resolve => setTimeout(resolve, 15_000));
  }
  throw new Error('Dev metric or correlated log evidence unavailable');
}
