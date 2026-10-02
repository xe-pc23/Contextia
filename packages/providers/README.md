# Provider ports and adapters — Phase 2, lane B

Import the seven interfaces and DTOs from `@contextia/providers`. They depend only on contracts; adapters own SDK/HTTP clients, environment configuration, timeouts, normalized parsing and sanitized error mapping. Phase 1 supplies Places V2, Open-Meteo, Bedrock decision and DynamoDB adapters. Phase 2 adds Geocode, injectable Routes V2 normalization and Bedrock follow-up.

Every port returns `ProviderResult<T>`. `ok` and `degraded` have usable data; `unavailable`, `timeout`, `error` and `not_requested` have `data: null`. Use contracts' `providerResultSchema` to validate normalized adapter output. Empty nearby results are successful arrays; the Phase 2 Geocode adapter marks an unresolved destination unavailable. Unavailable transit is never replaced with made-up times. Repository absence is `ok` with null; it differs from storage failure by status.

Places/Geocoding require explicit `persistenceIntent`. `getPlace({ persistenceIntent: 'storage' })` returns a `StoragePlace` wrapper. The history write requires these wrappers for every selected place; the adapter projects minimal public place fields before writing, and returns plain normalized cards on reads. This type proves which port path was selected, not that AWS was called: adapter tests must verify the actual GetPlace Storage request and matching IDs. SingleUse lists never enter history or chat persistence.

Model inputs include candidates, preferences, normalized enrichments, and bounded recent summaries. `decide` is called only after guards/candidates; the adapter validates `RecommendationDecisionSchema`, supplied place IDs and actual route facts, and returns a normalized failure after the allowed single repair attempt. `followUp` uses the same reference discipline and short recommendation-scoped messages. No chain-of-thought field is accepted.

Repository reads take authenticated user ownership; TTL-aware reads take the injected epoch time. Recommendation/pointer writes, proactive count/dedup writes, idempotency claims and conversation turns are atomic operations. `recordProactiveDelivery` rechecks cap/date/fingerprint/anchor and recommendation ID in the adapter; preview cannot call it. `writeContextSnapshot` updates the latest reference/fingerprint without consuming quota or recording an anchor as notified. `recentAnchors` is bounded by configuration.

Idempotency claims may have a null pointer while evaluation is in flight; a matching existing pending claim is not a finished response. The application must return a retry/conflict outcome rather than run a second real delivery. Completion stores a short-lived result reference, validates any selected place against the supplied Storage data, and uses the one-hour expiry. D reconciles the concrete persistence layout in DATA_MODEL before an adapter adds fields.

The proactive write carries `evaluationId`: a latest context snapshot written by that same evaluation must not suppress its first delivery as a duplicate. Another evaluation's matching fingerprint still applies. Recommendation ID recording prevents the same accepted recommendation from consuming quota twice. Follow-up selected places also require Storage wrappers before their facts are persisted with the conversation turn.

`getConversation` returns each assistant turn's normalized recommendation cards, including saved place/route references. Pass those turns to `followUp`, and validate model references against the original cards, saved assistant cards and current enrichment. This lets later questions refer to a new place suggested in an earlier chat turn without recreating provider facts from text.

Conversations require owner and live recommendation checks, one metadata item, an atomic maximum of eight user turns and a two-hour expiry. The append operation carries an already validated model reply; it never runs Bedrock. Notification sends are explicit server push, with one chosen delivery path per recommendation. Tokens and notification payloads are never logged. Cleanup removes all owned application records, including expired chat and idempotency, in bounded batches; Cognito deletion belongs to the application/infrastructure.

`test/ports.types.ts` is a compile-time consumer check: it exercises all seven exports and rejects SingleUse persistence, preview counter updates and fabricated unavailable data. Run `pnpm --filter @contextia/providers typecheck` plus the root gate.

## Phase 2 adapter configuration

`createAmazonLocationGeocodingProvider({ region, timeoutMs, policy? })` uses the existing `@aws-sdk/client-geo-places` dependency and `GeocodeCommand`. Event destination discovery must pass `persistenceIntent: 'single-use'`. Explicit Storage requests are supported; selected places still require the existing `GetPlace(Storage)` path before recommendation/chat persistence. Request coordinates are `[longitude, latitude]`, language follows locale and result count is bounded to five.

The configurable `GeocodingPolicy` defaults to confidence >= 0.8, a score gap >= 0.1 and at most 100 km from a supplied bias. These are conservative adapter quality thresholds, not new detector thresholds. Missing confidence, broad geographic regions, competing matches and distant results are unavailable with `GEOCODE_LOW_CONFIDENCE`, `GEOCODE_AMBIGUOUS` or `GEOCODE_OUT_OF_AREA`; empty results use `GEOCODE_NOT_FOUND`. Malformed/conflicting entries fail closed. A usable result contains one normalized destination and no raw upstream data. The composition root can supply a complete policy from its environment configuration when another distance budget is needed.

`createAmazonLocationRouteProvider({ region, timeoutMs }, client)` accepts a narrow `AmazonLocationRoutesClient` with `calculateRoutes(request, abortSignal)`. It maps transit/intermodal/pedestrian and departure/arrival planning, normalizes durations to minutes, transit line/mode, transfers and sanitized notices, and derives a stable evaluation-local route ID. It uses only returned schedules; missing schedules, unsupported regions and empty routes are unavailable rather than made-up travel times. Both adapters bound requests using AbortSignal and sanitize upstream errors.

**Routes live SDK wiring is intentionally incomplete:** the user declined dependency and lockfile changes. Without an injected client, the factory returns `unavailable / ROUTES_NOT_CONFIGURED`; it performs no network call and supplies no fallback route. D must arrange an approved Routes client before live routing can work. No transitive SDK dependency is imported as a workaround.

`BedrockRecommendationModel.followUp` returns `ChatReplySchema` with at most three cards. It accepts references only from the original recommendation, saved assistant cards and current usable Places/Routes enrichments. Place IDs/names/coordinates/distances and route modes/durations/schedules/transfers are checked together. Conversation prose cannot introduce provider facts. Structured output, explicit-JSON fallback and at most one validation repair share one timeout budget with `decide`. The model ID, region and timeout continue to come from the composition root; no model-specific ID is hardcoded.

The application owns chat authentication, recommendation ownership, eight-turn limits, two-hour expiry, Storage-intent persistence and provider dependency ordering. These adapters do not implement API routes or delivery counters. Geocode/routes failures exclude only affected candidates; other usable enrichment remains available to the application.

Open-Meteo current observations at quarter-hour timestamps are accepted within a bounded freshness interval instead of requiring an exact hourly timestamp. The observation must be at/before the evaluation time and the evaluation must be at/before the server clock. Future simulated evaluations still use hourly forecast coverage; out-of-range or stale weather remains unavailable. `current.interval` supplies the adapter's freshness bound, not a promise that observed weather applies to the future. Without an interval, only the exact observation timestamp qualifies as current data.

## D/A integration handoff and verification limits

- Keep event geocoding keyed by `event.id`, destination Places by that event anchor, current Places by `current`, and candidate routes by `place.placeId`. Deduplicate needs and execute geocode before destination routing and Places before candidate routing.
- Preserve the actual `arriveBy` request on event-route evidence. This PR adds backward-compatible `arriveBy?: string` metadata to `ProviderEnrichment.routes`; the latest A Phase 2 refinement requires it to equal the event start minus its arrival buffer. The D Phase 2 branch currently calls the route port with `arriveBy` but does not keep it in the evidence entry. D must copy the actual request value before integrating with A. This PR does not change A's contracts or D's application files.
- Routes transit data can include required display attributions. The current shared route contract has no attribution field; A/C/D must settle its minimal normalized representation and display before enabling live transit output. The SDK connection and live attribution behavior are unverified in this PR.
- Apply finite budgets from configuration (architecture defaults: Geocode/Places 2.5 s, Weather 2 s, Routes 3 s, Bedrock 7 s). Continue to persist only selected Storage data.
- AWS CLI inspection found no `hackathon-dev` profile in this Windows environment. The user requested proceeding with AWS smoke unexecuted. AWS MCP tools are unavailable in this session, so Codex-to-AWS proof and live Geocode/Routes/Bedrock/API smoke remain outstanding. No deploy or IAM change was performed. D owns the central `docs/hackathon/AGENT_LOG.md` and should record a successful operation once its credentials/client are ready.
- Unit fixtures and injected clients establish request/normalization/guard behavior only. They do not prove live coverage, dev deployment, the five-scenario integration gate or native behavior. Phase 3 is outside this task.

Provider API references: [Geocode V2](https://docs.aws.amazon.com/location/latest/APIReference/API_geoplaces_Geocode.html), [Geocode result/score fields](https://docs.aws.amazon.com/location/latest/APIReference/API_geoplaces_GeocodeResultItem.html), [CalculateRoutes V2](https://docs.aws.amazon.com/location/latest/APIReference/API_CalculateRoutes.html), [Intermodal route details](https://docs.aws.amazon.com/location/latest/developerguide/calculate-routes-intermodal-route.html).

## Phase 2 B validation (2026-10-02)

Native Windows, Node 24.13.1 and pnpm 10.29.3. A concise process-local PATH, trust limited to the inspected repository mise config and pnpm's shell emulator restored the existing frozen-lockfile installation. No dependency or lockfile change was made.

- `pnpm lint`: passed.
- `pnpm typecheck`: passed across all workspaces; final provider typecheck also passed.
- `pnpm test`: 28 files / 554 tests passed, including Geocode 21, Routes 37, Bedrock 47 and Weather 14.
- `pnpm build`: passed, including Web/API and iOS/Android JS exports.
- `pnpm cdk:synth`: offline dev/prod passed; no infrastructure deployment.
- Built provider exports: six injected-client smoke flows passed (geocode, route, decision, follow-up, reference rejection and unconfigured Routes).
- `git diff --check`: passed.

These results validate lane B's local work. Routes SDK wiring, live AWS smoke and the full Phase 2 integration gate remain incomplete as described above.
