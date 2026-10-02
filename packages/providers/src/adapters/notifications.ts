import { CreatePlatformEndpointCommand, PublishCommand, SetEndpointAttributesCommand, SNSClient } from '@aws-sdk/client-sns';
import { RegisterDeviceRequestSchema } from '@contextia/contracts';
import type { ProviderResult, RegisterDeviceRequest } from '@contextia/contracts';
import { z } from 'zod';
import type { NotificationMessage, NotificationProvider, NotificationRegistry, NotificationSendResult } from '../ports/NotificationProvider.js';
import { available, elapsedSince, mapAwsError, unavailable, withTimeout } from './shared.js';

const MessageSchema = z.object({ recommendationId: z.string().min(1).max(256), title: z.string().min(1).max(200), body: z.string().min(1).max(4000),
  device: RegisterDeviceRequestSchema.extend({ enabled: z.boolean(), lastSeenAt: z.string(), endpointArn: z.string().optional() }) });
const TicketSchema = z.object({ data: z.discriminatedUnion('status', [z.object({ status: z.literal('ok'), id: z.string().min(1) }), z.object({ status: z.literal('error'), details: z.object({ error: z.string().optional() }).optional() })]) });
export function createExpoNotificationProvider(config: { endpoint: string; timeoutMs: number; accessToken?: string }, fetcher: typeof fetch = fetch): NotificationProvider {
  const endpoint = z.url({ protocol: /^https$/ }).parse(config.endpoint);
  return { async send(input): Promise<NotificationSendResult> {
    const started = performance.now(); const parsed = MessageSchema.safeParse(input);
    if (!parsed.success || parsed.data.device.provider !== 'expo' || !/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(parsed.data.device.token)) return unavailable('error', elapsedSince(started), 'INVALID_REQUEST');
    if (!parsed.data.device.enabled) return unavailable('unavailable', elapsedSince(started), 'DEVICE_DISABLED');
    try {
      return await withTimeout(async signal => {
        const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal,
          headers: { 'content-type': 'application/json', ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}) },
          body: JSON.stringify({ to: parsed.data.device.token, title: parsed.data.title, body: parsed.data.body, sound: 'default', data: { recommendationId: parsed.data.recommendationId } }) });
        if (!response.ok) return unavailable('error', elapsedSince(started), response.status === 429 ? 'THROTTLED' : 'UPSTREAM_ERROR');
        const ticket = TicketSchema.safeParse(await response.json() as unknown);
        if (!ticket.success) return unavailable('error', elapsedSince(started), 'INVALID_NOTIFICATION_OUTPUT');
        if (ticket.data.data.status !== 'ok') return unavailable('error', elapsedSince(started), ticket.data.data.details?.error === 'DeviceNotRegistered' ? 'DEVICE_NOT_REGISTERED' : 'NOTIFICATION_REJECTED');
        return available('ok', { receiptId: ticket.data.data.id }, elapsedSince(started));
      }, config.timeoutMs);
    } catch (cause: unknown) { const mapped = mapAwsError(cause); return unavailable(mapped.status, elapsedSince(started), mapped.code); }
  } };
}

export type SnsNotificationRequest =
  | { operation: 'register'; applicationArn: string; token: string }
  | { operation: 'setAttributes'; endpointArn: string; attributes: { Token: string; Enabled: 'true' } }
  | { operation: 'publish'; endpointArn: string; message: string };
export interface SnsNotificationClient { send(request: SnsNotificationRequest, signal: AbortSignal): Promise<unknown> }
export function createSnsNotificationProvider(config: {
  region: string; stage: 'dev' | 'prod'; applicationArns: Partial<Record<'ios' | 'android', string>>; timeoutMs: number;
}, override?: SnsNotificationClient): NotificationProvider & NotificationRegistry {
  const arns = config.applicationArns;
  for (const [platform, arn] of Object.entries(arns)) {
    const match = /^arn:aws:sns:([^:]+):(\d{12}):app\/(APNS|APNS_SANDBOX|GCM)\/(contextia-(dev|prod)(?:-[A-Za-z0-9_-]+)?)$/.exec(arn);
    if (!match || match[1] !== config.region || match[5] !== config.stage || (platform === 'android' ? match[3] !== 'GCM' : match[3] === 'GCM')) throw new Error('SNS application does not match platform/stage/region');
  }
  const sdk = override ? undefined : new SNSClient({ region: config.region, maxAttempts: 1 });
  const client: SnsNotificationClient = override ?? { send(request, signal) {
    if (!sdk) throw new Error('SNS client unavailable');
    switch (request.operation) {
      case 'register': return sdk.send(new CreatePlatformEndpointCommand({ PlatformApplicationArn: request.applicationArn, Token: request.token }), { abortSignal: signal });
      case 'setAttributes': return sdk.send(new SetEndpointAttributesCommand({ EndpointArn: request.endpointArn, Attributes: request.attributes }), { abortSignal: signal });
      case 'publish': return sdk.send(new PublishCommand({ TargetArn: request.endpointArn, MessageStructure: 'json', Message: request.message }), { abortSignal: signal });
    }
  } };
  function validEndpoint(platform: 'ios' | 'android', endpoint: string): boolean {
    const application = arns[platform];
    return Boolean(application && endpoint.startsWith(application.replace(':app/', ':endpoint/') + '/') && /^[A-Za-z0-9-]+$/.test(endpoint.slice(endpoint.lastIndexOf('/') + 1)));
  }
  return {
    async register(input: RegisterDeviceRequest): Promise<ProviderResult<{ endpointArn: string }>> {
      const started = performance.now(); const parsed = RegisterDeviceRequestSchema.safeParse(input);
      if (!parsed.success || parsed.data.provider !== 'sns') return unavailable('error', elapsedSince(started), 'INVALID_REQUEST');
      const applicationArn = arns[parsed.data.platform];
      if (!applicationArn) return unavailable('unavailable', elapsedSince(started), 'PUSH_NOT_CONFIGURED');
      try {
        return await withTimeout(async signal => {
          const result = z.object({ EndpointArn: z.string() }).safeParse(await client.send({ operation: 'register', applicationArn, token: parsed.data.token }, signal));
          if (!result.success || !validEndpoint(parsed.data.platform, result.data.EndpointArn)) return unavailable('error', elapsedSince(started), 'INVALID_NOTIFICATION_OUTPUT');
          await client.send({ operation: 'setAttributes', endpointArn: result.data.EndpointArn, attributes: { Token: parsed.data.token, Enabled: 'true' } }, signal);
          return available('ok', { endpointArn: result.data.EndpointArn }, elapsedSince(started));
        }, config.timeoutMs);
      } catch (cause: unknown) { const mapped = mapAwsError(cause); return unavailable(mapped.status, elapsedSince(started), mapped.code); }
    },
    async send(input: NotificationMessage): Promise<NotificationSendResult> {
      const started = performance.now(); const parsed = MessageSchema.safeParse(input);
      if (!parsed.success || parsed.data.device.provider !== 'sns' || !parsed.data.device.endpointArn || !validEndpoint(parsed.data.device.platform, parsed.data.device.endpointArn)) return unavailable('error', elapsedSince(started), 'INVALID_REQUEST');
      if (!parsed.data.device.enabled) return unavailable('unavailable', elapsedSince(started), 'DEVICE_DISABLED');
      const applicationArn = arns[parsed.data.device.platform]!;
      const platform = applicationArn.split('/')[1]!;
      const payload = platform === 'GCM' ? { fcmV1Message: { message: { notification: { title: parsed.data.title, body: parsed.data.body }, data: { recommendationId: parsed.data.recommendationId } } } }
        : { aps: { alert: { title: parsed.data.title, body: parsed.data.body }, sound: 'default' }, recommendationId: parsed.data.recommendationId };
      try {
        const result = z.object({ MessageId: z.string().min(1) }).safeParse(await withTimeout(signal => client.send({ operation: 'publish', endpointArn: parsed.data.device.endpointArn!, message: JSON.stringify({ default: parsed.data.body, [platform]: JSON.stringify(payload) }) }, signal), config.timeoutMs));
        return result.success ? available('ok', { receiptId: result.data.MessageId }, elapsedSince(started)) : unavailable('error', elapsedSince(started), 'INVALID_NOTIFICATION_OUTPUT');
      } catch (cause: unknown) { const mapped = mapAwsError(cause); return unavailable(mapped.status, elapsedSince(started), mapped.code); }
    }
  };
}
