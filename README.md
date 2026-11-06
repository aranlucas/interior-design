# Roomform

An interior design studio built with TanStack Start + Router, React, Vercel AI SDK, and direct OpenAI image editing. Hosted as one Railway Node service with SQLite on a persistent volume.

Create a room, upload listing/camera photos, collect product photos or IKEA links, select references, and generate or refine a photorealistic visualization — from photos, a 3D guide, or freestyle with no photo at all. Original architecture remains the prompt's authority. Results include history, downloads, brush edits, before/after videos and a before/after slider.

## Secrets

Varlock resolves `OPENAI_API_KEY`, `SESSION_SECRET`, and the OIDC client secret from Bitwarden Secrets Manager. `.env.schema` contains references, never secret values. Supply `BITWARDEN_ACCESS_TOKEN` securely to the process or Railway service. Use a project-scoped machine token. Production uses `varlock run` at boot; secrets are not embedded into the build.

On macOS, save the bootstrap token in your login Keychain once:

```bash
npm run secrets:store
```

Paste the token at Varlock’s masked prompt. Varlock stores it under service `varlock`, account `roomform:local:BITWARDEN_ACCESS_TOKEN`. The tracked `.env.keychain` contains a native `keychain()` reference and is imported only on macOS outside local mode. macOS may ask you to authorize Varlock’s native Keychain access.

The Vite integration loads and validates config for `npm run dev` and `npm run build`; `npm start` resolves secrets at boot through `varlock run`. Keep SSR in `init-only` mode so resolved secrets stay out of build artifacts. Configuration and generated type declarations are defined in [`.env.schema`](.env.schema). On Railway or other non-macOS hosts, supply `BITWARDEN_ACCESS_TOKEN` through the platform's secret environment settings; that value takes precedence over the Keychain resolver. See [Varlock’s macOS Keychain guide](https://varlock.dev/plugins/macos-keychain/) for storage and access management.

`npm run dev:local` skips Keychain and Bitwarden resolution, makes credentials optional, and bypasses login. Production bundles disable that bypass. Unit tests mock `varlock/env` and do not load live secrets.

## Development

Node 24.8+. Install with `npm ci`, then run `npm run dev:local` for a local studio without Bitwarden or login. SQLite data defaults to `.data/`; generation is disabled unless you supply `OPENAI_API_KEY` in your shell. Override `DATA_DIR` or `APP_URL` as needed. When using `tailscale serve`, set `APP_URL` to the exact browser origin (for example, `https://host.tailnet.ts.net:8443`); its hostname is allowed by Vite and mutations require that origin.

For the regular secrets-backed setup, save the bootstrap token in macOS Keychain or supply `BITWARDEN_ACCESS_TOKEN` in the environment, then run `npm run dev`. Validate with `npm run check`, `npm test`, `npm run lint`, and `npm run fmt:check`. Use `npm run fmt` to format and `npm run build` to build.

Photo reconstruction requires **COLMAP 4.x** on the server. On macOS, install it with `brew install colmap`; optionally set `COLMAP_BIN` to an executable path. The existing Railway configuration does not install COLMAP, so provision it in the production container before enabling automatic reconstruction. The app runs sparse reconstruction on the CPU without CUDA; it does not provision dense reconstruction.

Normal tests mock reconstruction jobs. To exercise the real engine with overlapping `.jpeg`, `.png`, or `.webp` photos:

```bash
ROOMFORM_COLMAP_TEST_IMAGES=/absolute/path/to/photos npx vitest run src/lib/colmap-runner.integration.test.ts
```

## Railway

Deploy the repository, mount a persistent volume at `/data`, set `DATA_DIR=/data`, and use one replica. `railway.json` configures build/start and health checks. The app uses SQLite WAL and short synchronous transactions for room changes; image generation happens outside those transactions. Back up the persistent volume before migrating or removing it. Images live as SQLite blobs. See the [memory investigation](docs/image-memory-investigation.md) before choosing batch or concurrency limits; large batches have not been proven safe at 500 MB.

## Authentication

The existing shared Better Auth service provides OIDC at `https://auth.aranlucas.workers.dev/api/auth`. The production web client is `roomform_dd49377094d4bb7659702cb9`, registered with the exact `https://roomform-production.up.railway.app/api/auth/callback`, authorization-code grant, `openid profile email`, PKCE, and `client_secret_basic`. Its secret is held in Bitwarden and referenced by `.env.schema`. Client provisioning must follow the shared Auth service’s deployed client schema and SHA-256 secret hashing. This app verifies authorization state, nonce, PKCE and ID tokens using `openid-client`, then issues a seven-day encrypted HttpOnly app session. Storage and generation routes require that session; browser mutations require the configured app origin.

## Working with room photos and 3D guides

Open **3D room → Build 3D room** to reconstruct overlapping photos with COLMAP. Use several closer angles of the same unchanged room, with details visible in multiple photos. The result is a sparse, partial cloud of colored points and recovered camera positions, with gaps on blank walls and unseen areas. It has no known physical scale and is not a solid mesh or measurement tool. No OpenAI key or external image service is needed.

If alignment fails, **Help match photo details** accepts at least 12 distinct corresponding points in a pair of photos, using pointer or keyboard input. Matches undergo geometric verification and do not guarantee reconstruction. **Use a manual layout** offers an editable photo-covered rectangular room as a fallback. **Create AI finish** generates a separate 2D image with inferred areas labeled; it does not add measured geometry.

For a solid approximate model, choose **AI-assisted → Build AI room layout**. It sends up to the first eight room photos to OpenAI vision with `store: false` and requires `OPENAI_API_KEY`. The model estimates walls, openings, fixtures and large furniture. Inferred surfaces appear amber; even photo-visible elements have estimated positions and dimensions. This mode recovers neither camera poses nor depth maps. API work runs remotely; local rendering needs no CUDA, model weights or COLMAP.

Build status survives reloads. One build runs at a time per server, with a 12-minute deadline; COLMAP uses four CPU threads. Cancellation stops its child process and removes temporary images and feature databases. A failed rebuild keeps the previous successful result; changed input photos mark it outdated. After a server restart, the next status request marks an interrupted build failed so it can be retried.

For AI layouts, **Capture this view → Generate this view** sends a clean JPEG of the chosen 3D camera as the first image, followed by the original source photos in evidence order, selected references, and an optional prior design. The saved layout and camera/visibility settings accompany the prompt. The capture supplies camera/layout; source photos supply appearance evidence. This replaces the photo-only layout pre-pass, but does not guarantee adherence or physical fit.

Each guided design retains its guide and validated layout snapshot after reconstruction rebuilds. **Compare** shows guide versus design; **3D guide and source evidence** exposes retained constraints. Deleting the design removes those artifacts. Ownership, current reconstruction, source photos and capture dimensions are validated at generation: changed photos or a running/replaced build require rebuilding and a fresh capture. **Generate from photo** remains available.

Stored AI layouts use plan coordinates (+x right when facing +z). [`toSceneLayout`](src/lib/ai-room-layout-geometry.ts) converts once to Three.js coordinates, including fixture rotation and wall openings; stored evidence must retain its original convention to avoid mirrored geometry.

## Image generation

Modes are **Redesign** (restyle/refurnish while preserving architecture), **Stage** (furnish an empty room), **Paint** (change colors and finishes only), **Empty** (remove movable furniture), **Sketch** (render a drawing or 3D screenshot), and **Freestyle** (compose without a photo). Outdoor room types preserve fixed structures, boundaries, paving and permanent plantings. Optional people/pets and lighting controls affect the scene. Designs support history, starring, downloads, brush edits, a comparison slider and client-side before/after video export.

**Image settings** saves quality and size per room. Current defaults and supported choices live in [`image-settings.ts`](src/lib/image-settings.ts); `OPENAI_IMAGE_MODEL` overrides the model. The default is `gpt-image-2.6-sunburst` for detailed generation and editing, verified against the [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation) on November 5, 2026. PNG output, Max quality, and existing sizes are retained. Complexity uses the API default (`high`). Prompts follow the [GPT Image 2.6 prompting guide](https://developers.openai.com/api/docs/guides/image-prompting): separate requested edits from preservation constraints, retain source camera and product identities, and treat estimated plans as subordinate to source evidence and confirmed measurements. Outputs above `2560x1440` are experimental. **Match photo** and captured 3D guides preserve source aspect ratio within API pixel limits; freestyle uses its orientation choice. Designs record requested model, quality and size. Single-image runs also record reported output-token usage; displayed image-output cost uses the documented $30 per million output tokens for GPT Image 2.5 and 2.6 Sunburst/Flare and excludes input tokens. Transient rate limits retry twice with backoff, while exhausted credits stop immediately.

Runs request 1, 2, 4 or 8 variations in one call. A per-user lease prevents overlapping paid generations for that user, not concurrent users. The [memory investigation](docs/image-memory-investigation.md) records unresolved batch/concurrency limits.

Room measurements and editable product dimensions guide scale; client-supplied room measurements take precedence over estimates. Photo generation first attempts a vision layout plan (`OPENAI_LAYOUT_MODEL`), falling back to prompt-only guidance on failure. Freestyle, outdoor rooms and captured AI layouts skip that pre-pass. Pixel dimensions are never physical measurements, and AI output does not guarantee product fit.

Product import reads metadata and images from public HTTPS pages, including Shopify variant images and size choices. Confirm or edit imported dimensions before generation. Requests reject non-public IP ranges, pin validated DNS results and recheck redirects. Pages that block access or require JavaScript need an uploaded photo; there is no automatic Zillow import or general web scraper.

## Reliability validation

See [the behavior audit](docs/reliability-audit.md) for findings and scope. CI runs the existing checks/tests, a production build without external secrets, a negative control proving the targeted regressions fail on the audited baseline, and `npm run test:e2e` using published `e2e` and its web engine. The browser journey creates a room, autosaves a brief, renames it, verifies persistence after reload, and deletes it. It uses an isolated `.data/e2e` SQLite database and the existing development auth bypass; no model calls or provider credentials are required. Baseline logs and browser failure evidence are uploaded as CI artifacts. Tests and builds for this audit run only in CI.
