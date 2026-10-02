import { z } from 'zod';
import { GeoPointSchema, OpaqueIdSchema, TimestampSchema } from './context.js';
import { ProviderNeedSchema, RouteModeSchema, SignalNameSchema, TriggerTypeSchema, UrgencySchema } from './enums.js';

export const PlaceSchema = GeoPointSchema.extend({
  provider: z.literal('amazon-location'), placeId: OpaqueIdSchema, name: z.string().min(1),
  distanceMeters: z.number().nonnegative().optional()
});
export const RecommendationRouteSchema = z.strictObject({
  mode: RouteModeSchema, durationMinutes: z.number().nonnegative(),
  departAt: TimestampSchema.optional(), arriveAt: TimestampSchema.optional(),
  transfers: z.number().int().nonnegative().optional()
});
export const ActionSchema = z.strictObject({
  type: z.enum(['MAP', 'WEBSITE', 'TRANSIT', 'NONE']),
  url: z.url({ protocol: /^https?$/ }).nullable().optional()
});
export const RecommendationItemSchema = z.strictObject({
  title: z.string().min(1), reason: z.string().min(1), place: PlaceSchema.nullable().optional(),
  route: RecommendationRouteSchema.nullable().optional(), action: ActionSchema
});
export const ApiRecommendationItemSchema = RecommendationItemSchema.extend({ id: OpaqueIdSchema });
const decisionFields = { decisionReason: z.string().min(1), usedSignals: z.array(SignalNameSchema) };
export const NotifyDecisionSchema = z.strictObject({
  ...decisionFields, decision: z.literal('notify'), urgency: UrgencySchema, message: z.string().min(1),
  recommendations: z.array(RecommendationItemSchema).min(1).max(3)
});
export const SilentDecisionSchema = z.strictObject({
  ...decisionFields, decision: z.literal('silent'), urgency: z.null(), message: z.null(),
  recommendations: z.tuple([])
});
export const RecommendationDecisionSchema = z.discriminatedUnion('decision', [NotifyDecisionSchema, SilentDecisionSchema]);
export const CandidateOpportunitySchema = z.strictObject({
  type: TriggerTypeSchema, confidence: z.number().min(0).max(1), anchorKey: z.string().min(1),
  requiredSignals: z.array(SignalNameSchema), providerNeeds: z.array(ProviderNeedSchema),
  facts: z.record(z.string(), z.unknown())
});
export const ChatReplySchema = z.strictObject({ reply: z.string().min(1), recommendations: z.array(RecommendationItemSchema).max(3) });

export type Place = z.infer<typeof PlaceSchema>;
export type RecommendationRoute = z.infer<typeof RecommendationRouteSchema>;
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;
export type ApiRecommendationItem = z.infer<typeof ApiRecommendationItemSchema>;
export type NotifyDecision = z.infer<typeof NotifyDecisionSchema>;
export type SilentDecision = z.infer<typeof SilentDecisionSchema>;
export type RecommendationDecision = z.infer<typeof RecommendationDecisionSchema>;
export type CandidateOpportunity = z.infer<typeof CandidateOpportunitySchema>;
export type ChatReply = z.infer<typeof ChatReplySchema>;
