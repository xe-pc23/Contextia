import { RegisterDeviceRequestSchema } from '@contextia/contracts';
import type { RegisterDeviceRequest } from '@contextia/contracts';
import type { NotificationRegistry, StateRepository } from '@contextia/providers';
import { ApiFailure } from './apiFailure.js';

export interface DeviceServices {
  register(userId: string, request: RegisterDeviceRequest): Promise<{ registered: true }>;
  delete(userId: string, deviceId: string): Promise<void>;
}
export function createDeviceServices(state: Pick<StateRepository, 'upsertDevice' | 'deleteDevice'>, clock: () => Date, sns?: NotificationRegistry): DeviceServices {
  return {
    async register(userId, input) {
      const request = RegisterDeviceRequestSchema.parse(input);
      let endpointArn: string | undefined;
      if (request.provider === 'sns') {
        if (!sns) throw new ApiFailure('STATE_UNAVAILABLE');
        const registered = await sns.register(request);
        if (registered.status !== 'ok' && registered.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
        endpointArn = registered.data.endpointArn;
      }
      const result = await state.upsertDevice({ userId, device: { ...request, enabled: true, lastSeenAt: clock().toISOString(), ...(endpointArn ? { endpointArn } : {}) } });
      if (result.status !== 'ok' && result.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
      return { registered: true };
    },
    async delete(userId, deviceId) {
      const result = await state.deleteDevice({ userId, deviceId });
      if (result.status !== 'ok' && result.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    }
  };
}
