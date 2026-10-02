import { z } from 'zod';
import { ActivityContextSchema, CalendarEventContextSchema, CalendarStatusSchema, ContextInputSchema, LocationContextSchema, OpaqueIdSchema, ScenarioContextInputSchema, TimezoneSchema, UserPreferencesSchema, TimestampSchema } from './context.js';
import { GuardCodeSchema, ScenarioIdSchema, SignalNameSchema, TriggerTypeSchema, UrgencySchema } from './enums.js';
import { ProviderStatusMapSchema, WeatherReadingSchema } from './enrichment.js';
import { ApiRecommendationItemSchema } from './recommendation.js';

export function responseEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ requestId: OpaqueIdSchema, data });
}
export const ErrorResponseSchema = z.strictObject({
  requestId: OpaqueIdSchema,
  error: z.strictObject({
    code: z.string().min(1), message: z.string().min(1),
    details: z.array(z.strictObject({ path: z.string(), message: z.string().min(1) })).optional()
  })
});
export const HealthResponseSchema = z.strictObject({ status: z.literal('ok'), version: z.string().min(1) });
export const ProfileSchema = z.strictObject({ userId: OpaqueIdSchema, preferences: UserPreferencesSchema });
export const GetMeResponseSchema = responseEnvelopeSchema(ProfileSchema);
export const UpdatePreferencesRequestSchema = UserPreferencesSchema;
export const ProfileWriteHeadersSchema = z.strictObject({ ifNoneMatch: z.literal('*').optional() });
export const UpdatePreferencesResponseSchema = responseEnvelopeSchema(z.strictObject({ updated: z.literal(true) }));
export const ContextEvaluateRequestSchema = ContextInputSchema;
export const DemoFaultSchema = z.enum(['weather', 'routes']);
export type DemoFault = z.infer<typeof DemoFaultSchema>;
export const EvaluationHeadersSchema = z.strictObject({ idempotencyKey: z.uuid().optional(), demoFault: DemoFaultSchema.optional() });
const deliveryFields = { wouldSuppress: z.boolean(), guardCodes: z.array(GuardCodeSchema) };
export const DeliveryDiagnosticsSchema = z.discriminatedUnion('mode', [
  z.strictObject({ ...deliveryFields, mode: z.literal('preview'), status: z.literal('preview') }),
  z.strictObject({ ...deliveryFields, mode: z.literal('proactive'), status: z.enum(['ready', 'sent', 'failed', 'suppressed']) })
]).refine(value => value.wouldSuppress === (value.guardCodes.length > 0), { path: ['wouldSuppress'], message: 'wouldSuppress must match guard diagnostics' });
export const NormalizedPreviewContextSchema = z.strictObject({
  mode: z.literal('simulation'), evaluationAt: TimestampSchema, timezone: TimezoneSchema,
  stepGoal: z.number().int().min(1).max(200_000), location: LocationContextSchema,
  activity: ActivityContextSchema.optional(), calendar: z.array(CalendarEventContextSchema).max(100), calendarStatus: CalendarStatusSchema.optional(), preferences: UserPreferencesSchema
});
const evaluationFields = {
  evaluationId: OpaqueIdSchema, decisionReason: z.string().min(1), usedSignals: z.array(SignalNameSchema),
  delivery: DeliveryDiagnosticsSchema, providerStatus: ProviderStatusMapSchema, contextExpiresAt: TimestampSchema,
  // Optional during rollout so older persisted idempotency responses remain readable.
  normalizedContext: NormalizedPreviewContextSchema.optional(), weather: WeatherReadingSchema.nullable().optional()
};
export const EvaluationResultSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    ...evaluationFields, decision: z.literal('notify'), recommendationId: OpaqueIdSchema, triggerType: TriggerTypeSchema,
    urgency: UrgencySchema, message: z.string().min(1), recommendations: z.array(ApiRecommendationItemSchema).min(1).max(3)
  }),
  z.strictObject({
    ...evaluationFields, decision: z.literal('silent'), recommendationId: z.null(), triggerType: z.null(),
    urgency: z.null(), message: z.null(), recommendations: z.tuple([])
  })
]).superRefine((value, ctx) => {
  if (value.normalizedContext && value.delivery.mode !== 'preview') {
    ctx.addIssue({ code: 'custom', path: ['normalizedContext'], message: 'Normalized debug context is only returned for preview' });
  }
  if (value.delivery.mode !== 'proactive') return;
  if (value.decision === 'notify' && (value.delivery.status === 'suppressed' || value.delivery.wouldSuppress)) {
    ctx.addIssue({ code: 'custom', path: ['delivery'], message: 'Proactive notify must pass delivery guards' });
  }
  if (value.decision === 'silent' && (value.delivery.status !== 'suppressed' || !value.delivery.wouldSuppress)) {
    ctx.addIssue({ code: 'custom', path: ['delivery'], message: 'Proactive silent must be suppressed' });
  }
});
export const ContextEvaluateResponseSchema = responseEnvelopeSchema(EvaluationResultSchema);
export const RecommendationHistoryItemSchema = z.strictObject({
  id: OpaqueIdSchema, createdAt: TimestampSchema, triggerType: TriggerTypeSchema,
  message: z.string().min(1), recommendations: z.array(ApiRecommendationItemSchema).max(3)
});
export const RecommendationsQuerySchema = z.strictObject({
  limit: z.preprocess(value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value, z.number().int().min(1).max(50).default(20)),
  cursor: z.string().min(1).optional()
});
export const ListRecommendationsResponseSchema = responseEnvelopeSchema(z.strictObject({ items: z.array(RecommendationHistoryItemSchema), nextCursor: z.string().min(1).nullable() }));
export const RecommendationParamsSchema = z.strictObject({ recommendationId: OpaqueIdSchema });
export const GetRecommendationResponseSchema = responseEnvelopeSchema(RecommendationHistoryItemSchema);
export const ChatRequestSchema = z.strictObject({ message: z.string().min(1).max(1000) });
export const ChatResponseSchema = responseEnvelopeSchema(z.strictObject({
  conversationId: OpaqueIdSchema, reply: z.string().min(1), recommendations: z.array(ApiRecommendationItemSchema).max(3), expiresAt: TimestampSchema
}));
export const RegisterDeviceRequestSchema = z.strictObject({
  deviceId: OpaqueIdSchema, platform: z.enum(['ios', 'android']), provider: z.enum(['expo', 'sns']), token: z.string().min(1)
});
export const RegisterDeviceResponseSchema = responseEnvelopeSchema(z.strictObject({ registered: z.literal(true) }));
export const DeleteDeviceParamsSchema = z.strictObject({ deviceId: OpaqueIdSchema });
export const LoadScenarioParamsSchema = z.strictObject({ scenarioId: ScenarioIdSchema });
export const LoadScenarioResponseSchema = responseEnvelopeSchema(ScenarioContextInputSchema);

export type Profile = z.infer<typeof ProfileSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
export type DeliveryDiagnostics = z.infer<typeof DeliveryDiagnosticsSchema>;
export type RecommendationHistoryItem = z.infer<typeof RecommendationHistoryItemSchema>;
export type RecommendationsQuery = z.infer<typeof RecommendationsQuerySchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;
export type ContextEvaluateResponse = z.infer<typeof ContextEvaluateResponseSchema>;
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>;
export type UpdatePreferencesResponse = z.infer<typeof UpdatePreferencesResponseSchema>;
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;
export type ContextEvaluateRequest = z.infer<typeof ContextEvaluateRequestSchema>;
export type ListRecommendationsResponse = z.infer<typeof ListRecommendationsResponseSchema>;
export type GetRecommendationResponse = z.infer<typeof GetRecommendationResponseSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponseSchema>;
export type LoadScenarioResponse = z.infer<typeof LoadScenarioResponseSchema>;
