import { z } from 'zod';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const RecordSchema = z.object({ _aws: z.object({ CloudWatchMetrics: z.array(z.object({ Namespace: z.literal('Contextia') })).min(1) }),
  Stage: z.literal('dev'), Count: z.number().positive(), Provider: z.string().optional(), Operation: z.string().optional(),
  Decision: z.enum(['notify', 'silent']).optional(), TriggerType: z.string().optional(), Latency: z.number().min(0).optional() });
export function metricCoverage(messages: readonly string[]): boolean {
  const records = messages.flatMap(message => {
    try { const parsed = RecordSchema.safeParse(JSON.parse(message) as unknown); return parsed.success ? [parsed.data] : []; }
    catch { return []; }
  });
  return [['http', 'request'], ['evaluation', 'evaluate'], ['places', 'searchNearby'], ['modelAttempt', 'initial']].every(([provider, operation]) => records.some(record => record.Provider === provider && record.Operation === operation && record.Latency !== undefined))
    && records.some(record => record.Decision === 'notify' && record.TriggerType === 'STEP_GOAL_REST')
    && records.some(record => record.Decision === 'silent' && record.TriggerType === 'NONE');
}
/** Reads only the dev API's recent safe EMF records; never prints raw log messages. */
export async function verifyDevMetrics(startTime: number): Promise<void> {
  const client = new CloudWatchLogsClient({ region: 'ap-northeast-1', maxAttempts: 2 });
  for (let attempt = 0; attempt < 4; attempt++) {
    const messages: string[] = []; let nextToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await client.send(new FilterLogEventsCommand({ logGroupName: '/aws/lambda/contextia-dev-api', startTime,
        filterPattern: '{ $.Stage = "dev" }', limit: 1000, ...(nextToken ? { nextToken } : {}) }));
      messages.push(...(result.events ?? []).flatMap(event => event.message ? [event.message] : []));
      if (!result.nextToken || result.nextToken === nextToken) break;
      nextToken = result.nextToken;
    }
    if (metricCoverage(messages)) return;
    if (attempt < 3) await new Promise<void>(resolve => setTimeout(resolve, 15_000));
  }
  throw new Error('Dev EMF metrics coverage unavailable');
}
