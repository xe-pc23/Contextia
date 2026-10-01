# Synthetic input and provider fixtures

`scenarios/` contains the five agreed presets and synthetic normalized provider responses. All timestamps are fixed at 2026-10-01 in Asia/Tokyo; tests must inject that clock rather than use the current date. `primaryTrigger` and `providerNeeds` describe each fixture's purpose, not a precomputed detector/model decision.

Tests can import `scenarios` from `@contextia/test-fixtures`. Console presets should use `getScenarioInput(id)`, which returns a detached simulation/preview input without mock enrichments or recommendation text. Never install these mocks in the production provider container. Rain in the weather fixture is test data; a live weather preset cannot promise rain.

Each scenario can have more than one candidate. A adds detector-specific positive, negative, boundary and dedup fixtures during the relevant implementation phase; these Phase 0 fixtures do not prove a detector exists.
