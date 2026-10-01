# Provider ports — Phase 0

Import the seven interfaces and DTOs from `@contextia/providers`. They depend only on contracts; adapters own SDK/HTTP clients, environment configuration, timeouts, normalized parsing and sanitized error mapping. There are no live adapters yet.

Every port returns `ProviderResult<T>`. `ok` and `degraded` have usable data; `unavailable`, `timeout`, `error` and `not_requested` have `data: null`. Use contracts' `providerResultSchema` to validate normalized adapter output. Empty nearby/geocoding results are valid successful arrays. Unavailable transit is never replaced with made-up times. Repository absence is `ok` with null; it differs from storage failure by status.

Places/Geocoding require explicit `persistenceIntent`. `getPlace({ persistenceIntent: 'storage' })` returns a `StoragePlace` wrapper. The history write requires these wrappers for every selected place; the adapter projects minimal public place fields before writing, and returns plain normalized cards on reads. This type proves which port path was selected, not that AWS was called: adapter tests must verify the actual GetPlace Storage request and matching IDs. SingleUse lists never enter history or chat persistence.

Model inputs include candidates, preferences, normalized enrichments, and bounded recent summaries. `decide` is called only after guards/candidates; the adapter validates `RecommendationDecisionSchema`, supplied place IDs and actual route facts, and returns a normalized failure after the allowed single repair attempt. `followUp` uses the same reference discipline and short recommendation-scoped messages. No chain-of-thought field is accepted.

Repository reads take authenticated user ownership; TTL-aware reads take the injected epoch time. Recommendation/pointer writes, proactive count/dedup writes, idempotency claims and conversation turns are atomic operations. `recordProactiveDelivery` rechecks cap/date/fingerprint/anchor and recommendation ID in the adapter; preview cannot call it. `writeContextSnapshot` updates the latest reference/fingerprint without consuming quota or recording an anchor as notified. `recentAnchors` is bounded by configuration.

Idempotency claims may have a null pointer while evaluation is in flight; a matching existing pending claim is not a finished response. The application must return a retry/conflict outcome rather than run a second real delivery. Completion stores a short-lived result reference, validates any selected place against the supplied Storage data, and uses the one-hour expiry. D reconciles the concrete persistence layout in DATA_MODEL before an adapter adds fields.

The proactive write carries `evaluationId`: a latest context snapshot written by that same evaluation must not suppress its first delivery as a duplicate. Another evaluation's matching fingerprint still applies. Recommendation ID recording prevents the same accepted recommendation from consuming quota twice. Follow-up selected places also require Storage wrappers before their facts are persisted with the conversation turn.

Conversations require owner and live recommendation checks, one metadata item, an atomic maximum of eight user turns and a two-hour expiry. The append operation carries an already validated model reply; it never runs Bedrock. Notification sends are explicit server push, with one chosen delivery path per recommendation. Tokens and notification payloads are never logged. Cleanup removes all owned application records, including expired chat and idempotency, in bounded batches; Cognito deletion belongs to the application/infrastructure.

`test/ports.types.ts` is a compile-time consumer check: it exercises all seven exports and rejects SingleUse persistence, preview counter updates and fabricated unavailable data. Run `pnpm --filter @contextia/providers typecheck` plus the root gate.

Next implementation: Phase 1 Places V2, Open-Meteo, Bedrock and DynamoDB adapters with recorded/minimal mocks, then Phase 2 Geocoding/Routes/follow-up and Phase 3 remote notification adapters. Adapters are not implemented by these interfaces.
