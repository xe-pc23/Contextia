# Phase 0 — contracts and provider handoff

The owner asked to complete the prerequisites for assigning work; deployment remains the owner's responsibility. Implement the already agreed Phase 0 dependencies, then publish a shared starting point and concrete lane prompts. Do not implement adapters, detectors, connected product screens, or deploy AWS resources in this task.

1. On `feature/phase0-a-contracts-domain`, take the verified D scaffold, implement the v1 Zod request/response schemas, normalized enrichment types and five synthetic input/provider fixtures. Verify invalid inputs, privacy boundaries, model notify/silent consistency and fixture validity. Record small wire-format clarifications in `docs/API.md`.
2. On `feature/phase0-b-providers`, take A, define the seven ports with normalized results and owned/expiry-aware repository operations. Verify usable test doubles, all six provider statuses, no SDK types, and explicit Storage intent.
3. Complete the agreed C/E Phase 0 Vite/React and Expo shells with explicit unconnected UI, shared contract imports and build commands. D owns dependency coordination and lockfile changes. This closes the Phase 0 gate so all lanes can start Phase 1 rather than wait on the shells.
4. Review the combined changes, run lint, typecheck, tests, build and both-stage CDK synth; update the existing integration draft PR around the complete shared starting point.
5. On `feature/coordination-plan`, update the board and handoff with immutable commits and copyable Phase 1 lane prompts. Make the shared starting point available to all assigned lane branches without changing `main` or deploying.

Native development-build instructions belong to the E shell. JS export/build verification does not prove GPS, calendar, notifications or native device behavior; those remain assigned Phase 1–3 tasks.

Validation so far: A's initial 69 contract cases and three fixture tests failed before implementation; the added proactive-delivery consistency case also failed before its refinement. A then passed lint, typecheck, all 121 tests, build and both-stage offline CDK synth. Built package self-imports and frozen offline installation also passed. No AWS resources were changed.

Read-only review of A (`b59e4d4..2dfe1cf`) found one important omission (daily/feels-like weather facts) and one minor preset omission (preferences). Both now have regression coverage and are repaired. Source weather time and optional provider place facts are retained; public place payloads remain minimal. The revised five-command gate passed with 124 tests.

B's read-only review found that follow-up conversation reads needed saved assistant cards; `17cf044` repairs the DTOs and compile-time consumer test. All seven ports now typecheck. C's Vite/React shell booted in a browser without console warnings/errors. E's Expo shell exported iOS/Android JavaScript/Hermes assets and its dev/prod public configuration has separate names, schemes and application IDs. This is not native-device verification.

At `d88d2bf`, all five root checks passed; a fresh git-archived checkout also passed frozen offline installation and all five checks with 124 tests before any prior build output existed. The final independent read-only review found no Critical/Important blockers. Minor Node minimum and POSIX command portability notes are addressed during handoff. Remaining work is publication of the shared baseline, Phase 1 branches and copyable assignments; no AWS deployment or main merge belongs to this task.
