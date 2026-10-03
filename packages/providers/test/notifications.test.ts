import { describe, expect, it, vi } from 'vitest';
import { createExpoNotificationProvider, createSnsNotificationProvider } from '../src/adapters/notifications.js';
import type { NotificationMessage, SnsNotificationClient } from '../src/index.js';
const message: NotificationMessage = { userId: 'owner', recommendationId: 'rec-1', title: 'Contextia', body: 'private-message', device: { deviceId: 'd1', platform: 'ios', provider: 'expo', token: 'ExpoPushToken[private]', enabled: true, lastSeenAt: '2026-10-03T00:00:00Z' } };
const applicationArn = 'arn:aws:sns:ap-northeast-1:123456789012:app/APNS_SANDBOX/contextia-dev';
const endpointArn = applicationArn.replace(':app/', ':endpoint/') + '/endpoint-id';
describe('notification acceptance adapters', () => {
  it('requires an Expo accepted ticket, bounds HTTP timeout, and never returns upstream messages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: { status: 'ok', id: 'ticket-1' } })).mockResolvedValueOnce(Response.json({ data: { status: 'error', message: 'private-token', details: { error: 'DeviceNotRegistered' } } }));
    const provider = createExpoNotificationProvider({ endpoint: 'https://exp.host/--/api/v2/push/send', timeoutMs: 1000 }, fetcher);
    expect(await provider.send(message)).toMatchObject({ status: 'ok', data: { receiptId: 'ticket-1' } });
    const rejected = await provider.send(message);
    expect(rejected).toMatchObject({ status: 'error', data: null, code: 'DEVICE_NOT_REGISTERED' });
    expect(JSON.stringify(rejected)).not.toContain('private-token');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).data).toEqual({ recommendationId: 'rec-1' });
  });
  it('rejects disabled devices, mixed provider tokens, and redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 302 }));
    const provider = createExpoNotificationProvider({ endpoint: 'https://exp.host/--/api/v2/push/send', timeoutMs: 1000 }, fetcher);
    expect((await provider.send({ ...message, device: { ...message.device, enabled: false } })).status).toBe('unavailable');
    expect((await provider.send({ ...message, device: { ...message.device, provider: 'sns' } })).status).toBe('error');
    expect(fetcher).not.toHaveBeenCalled();
    expect((await provider.send(message)).status).toBe('error');
  });
  it('reconciles a reusable SNS endpoint token/enabled state, then sends one platform-specific payload', async () => {
    const send = vi.fn<SnsNotificationClient['send']>().mockResolvedValueOnce({ EndpointArn: endpointArn }).mockResolvedValueOnce({}).mockResolvedValueOnce({ MessageId: 'sns-ticket' });
    const provider = createSnsNotificationProvider({ region: 'ap-northeast-1', stage: 'dev', applicationArns: { ios: applicationArn }, timeoutMs: 1000 }, { send });
    expect(await provider.register({ deviceId: message.device.deviceId, platform: 'ios', provider: 'sns', token: message.device.token })).toMatchObject({ status: 'ok', data: { endpointArn } });
    expect(send.mock.calls[1]?.[0]).toEqual({ operation: 'setAttributes', endpointArn, attributes: { Token: message.device.token, Enabled: 'true' } });
    expect(await provider.send({ ...message, device: { ...message.device, provider: 'sns', endpointArn } })).toMatchObject({ status: 'ok', data: { receiptId: 'sns-ticket' } });
    expect(send.mock.calls[2]?.[0]).toMatchObject({ operation: 'publish', endpointArn });
    const request = send.mock.calls[2]?.[0];
    if (request?.operation !== 'publish') throw new Error('Expected publish');
    expect(JSON.parse(request.message)).toHaveProperty('APNS_SANDBOX');
    expect(request.message).not.toContain(message.device.token);
  });
  it('rejects endpoint ARNs outside its stage/application before SNS publish', async () => {
    const send = vi.fn<SnsNotificationClient['send']>();
    const provider = createSnsNotificationProvider({ region: 'ap-northeast-1', stage: 'dev', applicationArns: { ios: applicationArn }, timeoutMs: 1000 }, { send });
    expect((await provider.send({ ...message, device: { ...message.device, provider: 'sns', endpointArn: endpointArn.replace('contextia-dev', 'contextia-prod') } })).status).toBe('error');
    expect(send).not.toHaveBeenCalled();
    expect(() => createSnsNotificationProvider({ region: 'ap-northeast-1', stage: 'dev', applicationArns: { ios: applicationArn.replace('contextia-dev', 'contextia-prod') }, timeoutMs: 1000 }, { send })).toThrow();
  });
  it('uses FCMv1 data with a recommendation ID on Android and never retries an uncertain send', async () => {
    const androidArn = 'arn:aws:sns:ap-northeast-1:123456789012:app/GCM/contextia-dev';
    const androidEndpoint = androidArn.replace(':app/', ':endpoint/') + '/endpoint-id';
    const send = vi.fn<SnsNotificationClient['send']>().mockResolvedValueOnce({ MessageId: 'accepted' });
    const provider = createSnsNotificationProvider({ region: 'ap-northeast-1', stage: 'dev', applicationArns: { android: androidArn }, timeoutMs: 1000 }, { send });
    expect((await provider.send({ ...message, device: { ...message.device, platform: 'android', provider: 'sns', endpointArn: androidEndpoint } })).status).toBe('ok');
    const request = send.mock.calls[0]?.[0]; if (request?.operation !== 'publish') throw new Error('Expected publish');
    const envelope = JSON.parse(request.message) as { GCM: string };
    expect(JSON.parse(envelope.GCM)).toEqual({ fcmV1Message: { message: { notification: { title: message.title, body: message.body }, data: { recommendationId: message.recommendationId } } } });
    const stalled = vi.fn<SnsNotificationClient['send']>((_request, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('private'), { name: 'AbortError' }))); }));
    const timed = createSnsNotificationProvider({ region: 'ap-northeast-1', stage: 'dev', applicationArns: { android: androidArn }, timeoutMs: 5 }, { send: stalled });
    expect(await timed.send({ ...message, device: { ...message.device, platform: 'android', provider: 'sns', endpointArn: androidEndpoint } })).toMatchObject({ status: 'timeout', code: 'TIMEOUT' });
    expect(stalled).toHaveBeenCalledOnce();
  });
});
