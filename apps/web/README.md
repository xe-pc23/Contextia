# Web Scenario Console — Phase 0

Vite/React/strict TypeScript shell. `App.tsx` imports the canonical delivery schema and fixes Console delivery to preview. The screen clearly says unconnected; no authenticated evaluation, recommendation result, map or fake provider is installed yet.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev:web
pnpm --filter @contextia/web build
pnpm --filter @contextia/web preview
```

Development: `http://127.0.0.1:5173`. Build: `apps/web/dist`; local production preview: port 4173. Vite resolves contracts/fixtures to their workspace sources, so development does not require prebuilding those libraries.

Next task is C Phase 1 in `docs/PHASED_IMPLEMENTATION.md`: Cognito, MapLibre, editable context, the step-goal preset, real API requests, schema-validated results and provider diagnostics. Presets use `getScenarioInput` from `@contextia/test-fixtures`; send only that context to the API, never its mock provider results. Production Console stays preview and does not disable real notification guards.

D supplies the stage-specific API base URL, Cognito user pool/client, redirect URLs and restricted map configuration. Coordinate additional dependencies/lockfile changes with D. Do not call Amazon Location for recommendation logic from React components.

Tooling reference: [Vite getting started](https://vite.dev/guide/).
