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

## Remaining capacity risks

This is not a guarantee that every workload fits in 500 MB. An eight-image
response alone nearly reaches that ceiling in the reduced harness. The SDK
buffers the full JSON response and its base64 strings. Per-user leases also
allow different users to generate concurrently, and input images are loaded
before admission. Media responses make additional full-image copies.

Before claiming capacity safety, choose a bounded batch/concurrency policy after
testing realistic input-photo and concurrent-request loads. Serial one-image
provider calls can reduce response memory, but may change latency, input-token
charges, partial-result handling, and retry behavior; that requires an explicit
product/billing decision. Until that policy is settled, do not describe large multi-image batches as proven safe at 500 MB.
