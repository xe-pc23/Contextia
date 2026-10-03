import type { ProviderResult, RegisterDeviceRequest } from '@contextia/contracts';

export interface DeviceRegistration extends RegisterDeviceRequest { enabled: boolean; lastSeenAt: string; endpointArn?: string }
export interface NotificationRegistry {
  register(input: RegisterDeviceRequest): Promise<ProviderResult<{ endpointArn: string }>>;
}
export interface NotificationMessage {
  userId: string;
  device: DeviceRegistration;
  recommendationId: string;
  title: string;
  body: string;
}
export type NotificationSendResult = ProviderResult<{ receiptId: string }>;
export interface NotificationProvider {
  // Explicit server push only. Neither this message nor its device token may be logged.
  send(input: NotificationMessage): Promise<NotificationSendResult>;
}
