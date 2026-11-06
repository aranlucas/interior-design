# Untangle decision log — 2026-11-06

## Scope and baseline

Whole repository: routes, studio state and queries, generation, reconstruction,
geometry, measurements, product import, storage/auth, rendering, tests, and CI.
Started at `77531df` with a clean working tree. Preserve existing features and
prior memory-investigation findings. Both comment and test additions selected.
No local tests, builds, benchmarks, or browser tests: validation is CI-only.
Existing CI runs all Vitest tests, TypeScript, lint, formatting, and credential-free
configuration validation. No baseline test result is claimed.

## Inventory before edits and design

1. Make attachment/removal a room action with an atomic SQLite boundary.
   - Upload commits metadata before saving its blob; a failed save leaves a broken
     asset. Import implements a different save/commit/cleanup protocol.
   - Both routes duplicate room existence, capacity, ID/key construction and append.
   - Asset deletion commits metadata before removing the blob, unlike design
     deletion, whose blob removal participates in the room transaction.
   - Keep synchronous transaction callbacks: introduce an explicit synchronous
     blob writer; retain the existing asynchronous save contract for callers.
2. Separate generation prompt policy from request schemas.
   - `validation.ts` mixes schemas used by the browser and all room actions with
     long generation/edit prompts and scale interpretation. Prompt changes should
     be owned by generation, not the general request-validation module.
   - Move prompt functions and their helpers intact; use type-only schema imports.
3. Remove comments that narrate implementation; retain external contracts.
   - Candidate narration includes photo-nav's function description, guide-copy,
     reconstruction probe recheck, synchronous render, and drawing descriptions.
   - Retain SDK memory rationale, COLMAP coordinate/file conventions, auth handoff,
     browser download delay, retry behavior and deliberate queue/error semantics.
4. Audit tests last, preserving behavioral coverage.
   - Existing schema, prompt, storage, auth, transport, SSR, optimistic persistence,
     geometry and reconstruction tests protect observable contracts. Prompt text
     is an actual output contract, not a reason to remove its tests.
   - Add attachment regression cases: committed bytes and metadata must agree;
     capacity/missing room reject without a blob; storage failure rolls back the
     asset; deletion clears model references and only the selected owned blob.
     Expected results follow the persisted room/media contract, independently of
     transaction implementation.

5. Export brush masks in the source image coordinate space.
   - Review found the editor paints a reduced 1536px canvas, while the server
     correctly requires exact source dimensions. Resample only on export, keeping
     interaction memory bounded and the server contract unchanged.

6. Share camera input operations across the three renderers.
   - Duplicate zoom/keyboard code has diverged in polar clamping. Use configured
     OrbitControls limits for all; keep scene lifecycle, fitting and capture local.
   - Remove the autosave transaction-identity assertion, retaining timing and
     server-write behavior. Remove stale ESLint suppression comments.

## Necessary special cases retained

Public-fetch DNS pinning and redirect validation; public-page metadata fallbacks
and explicit Shopify variant verification; SQLite single-process restart recovery;
per-owner paid generation leases; global reconstruction admission/cancellation;
mode-specific image directives, guide evidence/coordinate validation; queued
optimistic drafts; transient image retries; optional real COLMAP integration test
requiring user-provided overlapping photos. These express real external contracts.

## Review and validation

Sequential independent review in progress. Findings and CI results recorded below.
