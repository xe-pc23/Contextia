# Shared v1 contracts

Import schemas and inferred types from `@contextia/contracts`. External input is `unknown`; call `safeParse` or `parse` at the HTTP/provider boundary. All object schemas reject unknown fields, including private calendar fields and raw upstream payloads.

`ContextEvaluateRequestSchema` permits real/proactive or simulation/preview. A successful parse does **not** authorize preview: D must still check the configured Console/demo authentication context.

`RecommendationDecisionSchema` is the Bedrock payload (items have no API IDs); `ContextEvaluateResponseSchema` is the HTTP envelope (items have IDs). Both enforce notify/silent shapes and the three-item maximum. B must additionally verify selected place IDs and route facts against the supplied enrichment; structural validation alone cannot prove those references are genuine.

`providerResultSchema(dataSchema)` validates normalized provider results: usable `ok`/`degraded` results contain typed data; the other four statuses contain `data: null`. API `providerStatus` exposes diagnostics only, with all five keys.

`ProviderPlaceSchema` can retain supplied opening status, categories and website URL during enrichment. The public recommendation `PlaceSchema` remains minimal; project the selected Storage-intent data to it. Weather retains the source timestamp, daily min/max and optional feels-like/sunrise/sunset facts; unavailable measurements are nullable rather than invented.

The health handler is already implemented. The authenticated routes described by these schemas are pending API integration; exporting their schemas does not make them live endpoints.

Run `pnpm exec vitest run packages/contracts/test`, then the five root validation commands before handoff.
