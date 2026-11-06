# Correctness and reliability audit

Baseline: remote default `ad1c209` (merged untangle pass), 2026-11-06. Clean isolated worktree. Tests/builds run only in CI.

## Inventory and boundaries

Roomform is a single-replica TanStack Start/React studio with SQLite WAL persistence. Public interfaces are room/media/import/reconstruction/generation/edit/session/auth HTTP routes and SSR room loaders. Journeys: sign in; create/rename/delete rooms; upload/delete photos and references; autosave briefs/settings; import public products; build/cancel/retry 3D/AI layouts; generate/refine/edit/star/delete/download designs.

Identity: encrypted expiring sessions, OIDC state/nonce/PKCE, origin checks on mutations. Storage is scoped by SHA-256 subject prefix and room IDs checked inside owner records. SQLite synchronous mutation transactions include attached/deleted blobs. Background generation and reconstruction run outside transactions and recheck room existence before publishing. Reconstruction has a global running map, cancellation and prior-result retention; generation uses per-owner leases and persisted jobs with restart recovery.

External trust: public import validates HTTPS/DNS/redirects and pins DNS; OpenAI responses and image/layout inputs are parsed/validated; COLMAP runs with bounded resources and temporary directories. Client data uses request-local collections, optimistic rollback and paced serial room saves. Production disables local auth bypass. CI currently checks TypeScript, Vitest, lint and format, but lacks a build and real browser journey.

## Findings recorded before changes

1. **High confidence, medium/high impact — generation lease can expire before work ends.** `src/lib/generation.server.ts` claims a 300-second lease, then awaits a layout pre-pass (up to 90 seconds), and only afterward starts a 270-second image deadline. A slow successful pre-pass plus slow image request permits another paid request after 300 seconds. The first worker's unconditional release also deletes the second worker's lease. Expected: one admitted generation per owner for the entire job. Fix uses active persisted jobs to prevent replacement until settlement (and rejects deletion while paid work remains active), rather than assuming provider deadlines always align with lease expiry. Regression must hold a worker past the lease and prove a second claim is rejected, then prove settlement permits retry.

2. **High confidence, medium impact — transient OIDC discovery failure poisons subsequent login.** `src/lib/auth.server.ts:config` memoizes a promise without clearing rejection. A temporary issuer/network outage makes all future login/callback attempts fail until server restart. Expected: concurrent callers share discovery, successful discovery stays cached, failed discovery can be retried. Regression will reject the first discovery and complete a later login with the same module instance.

## Reconciled/rejected hypotheses

- Attachment/deletion blob writes are inside `mutateRooms` transactions; existing trigger-based tests protect rollback. No evidence of blob/record partial deletion here.
- Tenant isolation uses hashed subjects, not caller-supplied prefixes; room/reference/design IDs are looked up in owner rooms. No demonstrated cross-account access.
- Reconstruction already rechecks global admission after the asynchronous engine probe and keeps a prior result on failure. No duplicate-start finding there.
- Single-replica SQLite initialization marks running generation jobs interrupted and removes stale leases; multi-replica coordination is outside the documented deployment contract.
- Memory/batch capacity remains an explicitly documented unproven operational limit, not a newly demonstrated defect.

## Validation plan

Preserve existing tests. Add targeted regressions for the two failure contracts, run them on both baseline and fixed code in CI, retaining baseline failure logs. Add a credential-free real `e2e` + `@e2e-dev/web` room creation/autosave/rename/reload/deletion journey against isolated SQLite/dev local mode. No agent/model steps or real production services. CI also builds the production bundle with local secrets resolution and production auth bypass disabled. Published versions verified via npm registry: `e2e@0.23.0`, `@e2e-dev/web@0.15.5`, Node `^22.22.3 || >=24.8.0`. Read upstream quickstart/CI/GitHub Actions docs (2026-11-06); installed guide will be consulted before authoring tests.

Independent review and CI outcomes: pending.
