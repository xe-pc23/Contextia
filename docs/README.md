# Contextia Documentation

This directory is the implementation contract for Contextia.

## Read order

1. [README_IMPLEMENTATION.md](./README_IMPLEMENTATION.md) — implementation blueprint and priority.
2. [SPEC.md](./SPEC.md) — product and functional source of truth.
3. [ARCHITECTURE.md](./ARCHITECTURE.md) — system boundaries and runtime design.
4. [API.md](./API.md) — HTTP contracts and shared enums/limits.
5. [DATA_MODEL.md](./DATA_MODEL.md) — DynamoDB access patterns and retention.
6. [TEST_STRATEGY.md](./TEST_STRATEGY.md) — automated/live test requirements.
7. [CI_CD.md](./CI_CD.md) — PR→dev / validated main→owner-triggered prod pipeline.
8. [DEMO.md](./DEMO.md) — judge Scenario Console and demo narrative.
9. [DECISIONS.md](./DECISIONS.md) — consolidated decisions.
10. [REVIEW_RESOLUTION.md](./REVIEW_RESOLUTION.md) — v1.0 review findings and v1.1 resolution.
11. [REFERENCES.md](./REFERENCES.md) — verified official references.
12. [BACKLOG.md](./BACKLOG.md) — explicitly deferred scope.
13. [PHASED_IMPLEMENTATION.md](./PHASED_IMPLEMENTATION.md) — five-person ownership, phase gates, and AI work orders.
14. [hackathon/TEAM_BOARD.md](./hackathon/TEAM_BOARD.md) — current next task for each owner and phase gate status.

Repository-level agent instructions live at [`../AGENTS.md`](../AGENTS.md).

## Precedence

When documents conflict:

```text
SPEC.md
  > API.md / DATA_MODEL.md
  > ARCHITECTURE.md
  > implementation details
```

`DECISIONS.md` explains why a choice exists; it does not override a later explicit SPEC change.

## Version

Current specification candidate: **v1.1 — 2026-09-30**
