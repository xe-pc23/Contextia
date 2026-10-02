import { describe, expect, it, vi } from 'vitest';
import { createDeviceServices } from '../src/application/devices.js';
import { createRequestHandler } from '../src/handler.js';
import { NOW, ok } from './support/repository.js';

describe('owned device API', () => {
  function setup() {
    const state = { upsertDevice: vi.fn(async () => ok(null)), deleteDevice: vi.fn(async () => ok(null)) };
    const devices = createDeviceServices(state, () => NOW);
    const logs: unknown[] = [];
    const handle = createRequestHandler({ version: 'test', clients: { webClientId: 'web', mobileClientId: 'mobile' }, log: entry => logs.push(entry), devices });
    const request = { requestId: 'req-device', claims: { sub: 'owner', clientId: 'mobile' }, method: 'POST', path: '/v1/devices' };
    const body = { deviceId: 'installation-1', platform: 'ios', provider: 'expo', token: 'ExponentPushToken[private-token]' };
    return { state, handle, request, body, logs };
  }
  it('registers and rotates only the authenticated owner, without returning or logging tokens', async () => {
    const { state, handle, request, body, logs } = setup();
    const result = await handle({ ...request, body: JSON.stringify(body) });
    expect(result.statusCode).toBe(200);
    expect(state.upsertDevice).toHaveBeenCalledWith({ userId: 'owner', device: { ...body, enabled: true, lastSeenAt: NOW.toISOString() } });
    await handle({ ...request, body: JSON.stringify({ ...body, token: 'ExpoPushToken[rotated-private]' }) });
    expect(state.upsertDevice).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logs) + result.body).not.toContain('private-token');
  });
  it('requires the mobile client and rejects ownership injection and oversized tokens before persistence', async () => {
    const { state, handle, request, body } = setup();
    expect((await handle({ ...request, claims: null, body: JSON.stringify(body) })).statusCode).toBe(401);
    expect((await handle({ ...request, claims: { sub: 'owner', clientId: 'web' }, body: JSON.stringify(body) })).statusCode).toBe(403);
    for (const input of [{ ...body, userId: 'victim' }, { ...body, token: 'x'.repeat(4097) }, { ...body, deviceId: 'x'.repeat(129) }]) {
      expect((await handle({ ...request, body: JSON.stringify(input) })).statusCode).toBe(400);
    }
    expect(state.upsertDevice).not.toHaveBeenCalled();
    expect((await handle({ ...request, method: 'DELETE', path: '/v1/devices/' + 'x'.repeat(129) })).statusCode).toBe(400);
    expect(state.deleteDevice).not.toHaveBeenCalled();
  });
  it('deletes idempotently in the authenticated partition and propagates storage failures safely', async () => {
    const { state, handle, request, body } = setup();
    expect((await handle({ ...request, method: 'DELETE', path: '/v1/devices/installation-1' })).statusCode).toBe(204);
    expect(state.deleteDevice).toHaveBeenCalledWith({ userId: 'owner', deviceId: 'installation-1' });
    state.upsertDevice.mockResolvedValueOnce({ status: 'error', data: null, code: 'PRIVATE_FAILURE' } as never);
    const result = await handle({ ...request, body: JSON.stringify(body) });
    expect(result.statusCode).toBe(503); expect(result.body).not.toContain('PRIVATE_FAILURE');
  });
});
