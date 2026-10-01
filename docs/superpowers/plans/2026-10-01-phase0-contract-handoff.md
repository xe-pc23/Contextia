# Phase 0 — contracts and provider handoff

The owner asked to complete the prerequisites for assigning work; deployment remains the owner's responsibility. Implement the already agreed A/B Phase 0 dependencies, then publish a shared starting point and concrete lane prompts. Do not implement adapters, detectors, client screens, or deploy AWS resources in this task.

1. On `feature/phase0-a-contracts-domain`, take the verified D scaffold, implement the v1 Zod request/response schemas, normalized enrichment types and five synthetic input/provider fixtures. Verify invalid inputs, privacy boundaries, model notify/silent consistency and fixture validity. Record small wire-format clarifications in `docs/API.md`.
2. On `feature/phase0-b-providers`, take A, define the seven ports with normalized results and owned/expiry-aware repository operations. Verify usable test doubles, all six provider statuses, no SDK types, and explicit Storage intent.
3. Review the combined changes, run lint, typecheck, tests, build and both-stage CDK synth; publish stacked draft PRs and attach them to this chat.
4. On `feature/coordination-plan`, update the board and handoff with immutable commits, copyable lane prompts and the remaining Phase 0 gate. Make the shared starting point available to all assigned lane branches without changing `main` or deploying.

Phase 0 integration still needs C's real Vite/React scaffold and E's real Expo scaffold. A/B can prepare their Phase 1 implementation tests while that gate is pending; production integration waits for the gate.

Validation so far: A's initial 69 contract cases and three fixture tests failed before implementation; the added proactive-delivery consistency case also failed before its refinement. A then passed lint, typecheck, all 121 tests, build and both-stage offline CDK synth. Built package self-imports and frozen offline installation also passed. No AWS resources were changed.

Read-only review of A (`b59e4d4..2dfe1cf`) found one important omission (daily/feels-like weather facts) and one minor preset omission (preferences). Both now have regression coverage and are repaired. Source weather time and optional provider place facts are retained; public place payloads remain minimal. The revised five-command gate passed with 124 tests. B and final lane distribution are still pending.
