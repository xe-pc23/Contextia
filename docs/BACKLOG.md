# BACKLOG.md — Deferred Scope

Items here are explicitly **not required for v1 hackathon shipping** unless promoted by a human.

## Product
- automatic reservation/booking
- ticket purchasing
- long-term assistant memory
- social/review ingestion
- advanced commute disruption provider
- richer personalization/learning

## Platform
- staging environment
- per-PR ephemeral AWS environments
- multi-region active/active
- vector database / RAG
- complex workflow orchestration

## Mobile
- investigate Expo DevMenu native reload wait observed on iOS 26.5 / SDK 57; process restart is the
  current development workaround (see `MOBILE_VALIDATION.md`); no dependency patch is included
- production-hardening of all vendor-specific background execution edge cases
- deeper Health Connect history analytics
- Apple Health aggregation beyond step goal use case

## Web
- public address autocomplete for Japan (not required)
- advanced route visualization
- shareable scenario URLs

## Ops
- X-Ray
- advanced alarms/on-call
- WAF tuning
- full cost dashboard

Before implementing a backlog item, update SPEC/DECISIONS if it changes product behavior or contracts.
