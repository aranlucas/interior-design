# Image generation memory investigation — 2026-10-31

## What is established

- Railway reported an out-of-memory crash at 04:24 UTC for deployment
  `584f6058-e9c5-4af7-8e10-522afac7f0d0`, commit `8037557`. A 30-second memory
  sample reached 499,937,280 bytes, essentially the configured 500 MB ceiling.
- A generation request was accepted at 04:23:17; the server was listening again
  at 04:24:58. The logs do **not** record the returned image size or allocation
  phase. A preceding generic Studio error does not establish its cause.
- `ai@7.0.157` lazily decodes a generated file's `uint8Array` using
  `atob` followed by `Uint8Array.from(string, mapper)`. This creates large
  transient JavaScript allocations and caches both base64 and decoded bytes.
  Roomform used this getter for every generated image, then copied it again
  with `Buffer.from(data)` before binding to SQLite.

## Recorded offline experiment

These historical measurements are investigation evidence, not a recurring
capacity check. The original profiler is no longer included. Run the maintained
memory-path regressions with:

```sh
npx vitest run src/lib/generation.test.ts src/lib/storage.server.test.ts src/lib/generation.transport.test.ts
```

Those tests reject the allocation-heavy SDK getter, verify exact generated and
edited bytes, and preserve SQLite binary/subarray semantics. They use synthetic
responses and local storage. They do not claim a production memory ceiling.

The recorded experiment used a deterministic 3840×2160 PNG (11,078,340 bytes).
A fresh process read a locally streamed mock OpenAI response through the SDK
and wrote temporary SQLite bytes; fixture generation was outside measured RSS.

Observed on Node 24.22.1, Linux; decimal MB, not MiB:

| Path                                      | Images | Peak process RSS |
| ----------------------------------------- | -----: | ---------------: |
| Existing SDK getter + copied SQLite bind  |      1 |         547.6 MB |
| Native base64 decode + direct binary bind |      1 |         172.7 MB |
| Native base64 decode + direct binary bind |      8 |         493.3 MB |

This reproduces an allocation mechanism sufficient to exceed the production
limit for one plausible-sized 4K PNG. It is a **strong candidate**, not proof
that the incident returned this size of image or failed at this exact phase.
The harness is not the complete application and does not include input photos,
other requests, or a production-equivalent memory baseline.

## Why native decoding and direct binding matter

Generation decodes base64 with Node’s native `Buffer.from(..., "base64")` to avoid
the SDK’s string iterator and decoded-image cache. SQLite binds binary data
directly, preserving UTF-8 conversion for strings. The tests above protect exact
single/batch/edit bytes, subarray ranges and snapshot semantics. These changes
do not bound the full response or concurrent-request memory.

## Admission and batch changes — 2026-11-10

Live Railway configuration inspected during this change has a 1,000,000,000-byte
service memory limit and one replica. Recent inspected runtime logs showed
sleep/shutdown cycles; they did not establish a new OOM event. The older incident
above remains the evidence for the previous 500 MB configuration.

- Generation, brush edits and reconstruction share one server-wide processing
  slot, acquired before loading image blobs. Other starts return 409. The slot
  has no expiring lease: it releases only when setup fails or work settles,
  including abort and cleanup. Per-user paid-work leases remain in place.
- Image input lengths are read using SQLite `length(data)` before materializing
  blobs. The combined limit is 32,000,000 bytes, including a captured guide and
  previous design, or a brush mask. AI reconstruction checks its selected eight
  source images; classical reconstruction checks all its inputs.
- Variations request `n: 1` sequentially, decode natively, and save the result
  before the next provider request. Only design metadata accumulates across the
  batch. A failed batch removes intermediate blobs and publishes no partial
  result. Each response's token usage belongs only to that variation.
- Serial calls increase latency and repeat input-token billing. A later failure
  cannot refund earlier provider work. The UI explains separate variation billing.
- Media responses no longer make an explicit `Buffer.from` copy before the
  Response constructor. Brush uploads similarly avoid a redundant typed-array copy.

Maintained regressions cover cross-user/job-type admission before image reads,
release after failure, exact output bytes, per-image billing metadata, aggregate
input limits, saving before the next request, and failed-batch cleanup:

```sh
npx vitest run src/lib/memory-admission.test.ts src/lib/heavy-work.test.ts src/lib/generation.test.ts src/lib/generation.transport.test.ts src/lib/reconstruction-jobs.test.ts
```

An additional **temporary offline workload** completed eight variations through
the installed SDK and SQLite with 30 MB of input images and 11,078,340 bytes per
synthetic output. All eight provider requests used `n: 1`. Observed process RSS
reached approximately 507 MB on macOS / Node 26.13.0, from an approximately 88 MB
pre-generation process baseline. The harness streamed mock provider JSON and did
not use credentials or paid requests. It was development scaffolding and was
removed after measurement. These numbers are not directly comparable to the
older Linux experiment above.

## Remaining capacity limits

This does not establish that the full application fits every workload at 500 MB
or even prove a production peak below 1 GB. The offline workload excludes the
Varlock launcher, production server baseline, concurrent media downloads and
COLMAP's native process. The SDK still buffers one complete JSON response and
its base64 data. The global slot applies to this single-process, single-replica
architecture; horizontal scaling requires shared admission and storage design.

The code changes are local until deployed. After deployment, exercise realistic
photo/reference sets, brush edits and AI layouts while checking Railway memory
and OOM events. Retain the 1 GB limit during that validation. Do not raise batch
parallelism or claim 500 MB capacity from these synthetic results.
