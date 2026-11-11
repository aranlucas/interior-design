import { ENV } from "varlock/env";
import { createOpenAI } from "@ai-sdk/openai";
import { generateImage } from "ai";
import {
  assertImageBudget,
  createJob,
  finishJob,
  rooms,
  mutateRooms,
  claimGeneration,
  releaseGeneration,
  load,
  save,
  ownerPrefix,
  remove,
} from "./storage.server";
import { designInput } from "./validation";
import { buildPrompt, buildEditPrompt, buildFinalPrompt, isOutdoor } from "./generation-prompts";
import { outputSize, orientationSize, pngDimensions } from "./image-size";
import { analyzeLayout } from "./layout.server";
import { assertCurrentGuide, prepareRoomGuide } from "./room-guide.server";
import {
  defaultImageModel,
  defaultImageSettings,
  finalImageSettings,
  outputCost,
} from "./image-settings";
import { acquireHeavyWork } from "./heavy-work.server";
import { generationError, retryImageRequest } from "./image-errors.server";

import type { Design, Asset } from "./types";
import type { z } from "zod";
function mediaType(key: string) {
  return key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
}
/** Prompts are kept beside the image, not in rooms.json, which every poll re-reads. */
const promptKeyFor = (designKey: string) => designKey.replace(/\.png$/, "-prompt.txt");
const promptBlob = (design: Design, prompt: string) => ({
  key: design.promptKey!,
  bytes: Buffer.from(prompt),
  type: "text/plain",
});
/** The placement pre-pass only helps when there are products to place in a furnished room. */
export function wantsPlacementPlan(mode: z.infer<typeof designInput>["mode"], refKinds: string[]) {
  return (mode === "redesign" || mode === "stage") && refKinds.includes("product");
}
/**
 * Claim the per-user paid-generation lease and the server-wide heavy-work slot, then run the
 * admission checks; release both if anything before job creation fails.
 */
async function admitJob(owner: string, roomId: string, ttl: number, admit: () => Promise<void>) {
  let releaseWork = () => {};
  let claimed = false;
  try {
    if (!claimGeneration(owner, ttl))
      throw new Error("A design is already being generated. Please wait for it to finish.");
    claimed = true;
    releaseWork = acquireHeavyWork();
    await admit();
    return { job: createJob(owner, roomId), releaseWork };
  } catch (error) {
    try {
      if (claimed) releaseGeneration(owner);
    } finally {
      releaseWork();
    }
    throw error;
  }
}
/** Save design blobs, then append designs to the room; remove every blob if either step fails. */
async function persistDesigns(
  owner: string,
  roomId: string,
  designs: Design[],
  blobs: { key: string; bytes: Uint8Array; type: string }[],
) {
  try {
    for (const blob of blobs) await save(blob.key, blob.bytes, blob.type);
    const target = await mutateRooms(owner, (latest) => {
      const target = latest.find((r) => r.id === roomId);
      if (!target) throw new Error("Room was removed during generation.");
      target.designs.unshift(...designs);
      return target;
    });
    return target.designs[0].id;
  } catch (error) {
    for (const blob of blobs) remove(blob.key);
    throw error;
  }
}
export async function startGeneration(owner: string, raw: z.input<typeof designInput>) {
  const input = designInput.parse(raw);
  const u = { sub: owner };
  const settings = input.imageSettings ?? defaultImageSettings;
  const model = ENV.OPENAI_IMAGE_MODEL || defaultImageModel;
  if (!ENV.OPENAI_API_KEY)
    throw new Error("Add OPENAI_API_KEY to the server environment to generate a design.");
  const all = await rooms(u.sub);
  const room = all.find((r) => r.id === input.roomId);
  if (!room) throw new Response("Room not found", { status: 404 });
  const base =
    input.baseId && input.mode !== "freestyle"
      ? room.assets.find((a) => a.id === input.baseId && a.kind === "room")
      : undefined;
  if (input.baseId && input.mode !== "freestyle" && !base)
    throw new Error("Choose a room photo as your base view.");
  const context = base
    ? room.assets.filter((a) => a.kind === "room" && a.id !== base.id).slice(0, 3)
    : [];
  const selected = input.assetIds
    .map((id) => room.assets.find((a) => a.id === id && a.kind !== "room"))
    .filter((a) => !!a);
  if (selected.length !== input.assetIds.length)
    throw new Response("Choose references from this room.", { status: 400 });
  // Empty mode never uses references; sending them only invites the model to add furniture.
  const refs = input.mode === "empty" ? [] : selected;
  const previous = input.previousDesignId
    ? room.designs.find((d) => d.id === input.previousDesignId)
    : undefined;
  if (input.previousDesignId && !previous) throw new Error("Previous design not found.");
  const count = input.count ?? 1;
  const ttl = 120_000 + count * 300_000;
  let releaseWork = () => {};
  let guide: Awaited<ReturnType<typeof prepareRoomGuide>> | undefined;
  let originalPhotos: Asset[];
  let images: Uint8Array[];
  let job;
  let claimed = false;
  try {
    if (!claimGeneration(u.sub, ttl))
      throw new Error("A design is already being generated. Please wait for it to finish.");
    claimed = true;
    releaseWork = acquireHeavyWork();
    guide = input.roomGuide ? await prepareRoomGuide(owner, room, input.roomGuide) : undefined;
    originalPhotos = guide ? guide.photos : base ? [base, ...context] : [];
    const ordered = [...originalPhotos, ...refs];
    assertImageBudget(
      [...ordered.map((a) => a.key), ...(previous ? [previous.key] : [])],
      guide?.image.byteLength,
    );
    images = [];
    for (const asset of ordered) {
      const bytes = await load(asset.key);
      if (!bytes) throw new Error("A reference image is missing. Please upload it again.");
      images.push(bytes);
    }
    if (guide) images.unshift(guide.image);
    await mutateRooms(u.sub, (latest) => {
      const target = latest.find((r) => r.id === room.id);
      if (!target) throw new Error("Room was removed before generation started.");
      if (input.roomGuide) assertCurrentGuide(target, input.roomGuide.resultId);
      target.notes = input.notes;
      target.style = input.style;
      target.measurements = input.measurements;
      target.imageSettings = settings;
    });
    job = createJob(u.sub, room.id);
  } catch (error) {
    try {
      if (claimed) releaseGeneration(u.sub);
    } finally {
      releaseWork();
    }
    throw error;
  }
  void settleGeneration(
    u.sub,
    job.id,
    async () => {
      const current = (await rooms(u.sub)).find((r) => r.id === room.id);
      if (!current) throw new Error("Room was removed before generation started.");
      if (input.roomGuide) assertCurrentGuide(current, input.roomGuide.resultId);
      const plan =
        guide ||
        !base ||
        isOutdoor(room.type) ||
        !wantsPlacementPlan(
          input.mode,
          refs.map((r) => r.kind),
        )
          ? null
          : await analyzeLayout({
              mode: input.mode,
              baseImage: images[0],
              mediaType: mediaType(base.key),
              roomType: room.type === "Other" ? "room" : room.type.toLowerCase(),
              references: refs.map((r) => ({
                name: r.name,
                kind: r.kind,
                dimensions: r.dimensions,
              })),
              measurements: input.measurements,
              style: input.style,
              brief: input.notes,
            });
      const prompt = buildPrompt(
        room.type,
        input,
        refs,
        originalPhotos.length + (guide ? 1 : 0),
        plan || undefined,
        guide?.constraints,
      );
      if (previous) {
        const bytes = await load(previous.key);
        if (!bytes) throw new Error("The previous design image is missing. Choose another design.");
        images.push(bytes);
      }
      const provider = createOpenAI({ apiKey: ENV.OPENAI_API_KEY });
      const size =
        input.mode === "freestyle"
          ? orientationSize(input.orientation)
          : guide || settings.size === "photo"
            ? guide || base
              ? outputSize(images[0])
              : previous
                ? outputSize(images[images.length - 1])
                : orientationSize(input.orientation)
            : settings.size;
      const deadline = AbortSignal.timeout(ttl - 30_000);
      const designs: Design[] = [];
      // Variations share one prompt: stored once, after every image succeeds.
      const promptKey = `${ownerPrefix(u.sub)}${room.id}/${crypto.randomUUID()}-prompt.txt`;
      try {
        for (let index = 0; index < count; index++) {
          const signal = AbortSignal.any([deadline, AbortSignal.timeout(270_000)]);
          // Scope each response to one iteration and save it before requesting the next.
          const result = await retryImageRequest(
            () =>
              generateImage({
                model: provider.image(model),
                prompt: { text: prompt, images },
                size,
                providerOptions: { openai: { quality: settings.quality, outputFormat: "png" } },
                n: 1,
                maxRetries: 0,
                abortSignal: signal,
              }),
            signal,
          );
          const createdAt = new Date().toISOString();
          const id = crypto.randomUUID();
          const design = {
            id,
            key: `${ownerPrefix(u.sub)}${room.id}/${id}.png`,
            prompt: input.notes,
            promptKey,
            createdAt,
            baseId: base?.id ?? "",
            plan: plan || undefined,
            mode: input.mode,
            inferred: input.fillGaps || undefined,
            generation: {
              model,
              quality: settings.quality,
              size,
              outputTokens: result.usage?.outputTokens,
              outputCostUsd: outputCost(model, result.usage?.outputTokens),
            },
            guide: guide && {
              ...guide.constraints.capture,
              key: `${ownerPrefix(u.sub)}${room.id}/${id}-guide.jpeg`,
              layoutKey: `${ownerPrefix(u.sub)}${room.id}/${id}-layout.json`,
              photoIds: originalPhotos.map((photo) => photo.id),
              assetIds: refs.map((ref) => ref.id),
              previousDesignId: previous?.id,
              style: input.style,
              measurements: input.measurements,
              people: input.people,
              lighting: input.lighting,
            },
          };
          designs.push(design);
          await save(design.key, Buffer.from(result.image.base64, "base64"), "image/png");
          if (design.guide && guide) {
            await save(design.guide.key, guide.image, "image/jpeg");
            await save(design.guide.layoutKey, guide.snapshot, "application/json");
          }
        }
        await save(promptKey, prompt, "text/plain");
        const target = await mutateRooms(u.sub, (latest) => {
          const target = latest.find((r) => r.id === room.id);
          if (!target) throw new Error("Room was removed during generation.");
          target.designs.unshift(...designs);
          return target;
        });
        return target.designs[0].id;
      } catch (error) {
        for (const design of designs) {
          for (const key of [
            design.key,
            design.promptKey,
            design.guide?.key,
            design.guide?.layoutKey,
          ]) {
            if (key) remove(key);
          }
        }
        throw error;
      }
    },
    releaseWork,
  ).catch((error) => console.error("Could not settle generation job", error));
  return { jobId: job.id };
}
/** Re-render a chosen draft at maximum quality, keeping its content unchanged. */
export async function startFinalRender(owner: string, input: { roomId: string; designId: string }) {
  if (!ENV.OPENAI_API_KEY)
    throw new Error("Add OPENAI_API_KEY to the server environment to render a design.");
  const model = ENV.OPENAI_IMAGE_MODEL || defaultImageModel;
  const room = (await rooms(owner)).find((r) => r.id === input.roomId);
  if (!room) throw new Response("Room not found", { status: 404 });
  const source = room.designs.find((d) => d.id === input.designId);
  if (!source) throw new Error("Design not found.");
  let bytes!: Uint8Array;
  const { job, releaseWork } = await admitJob(owner, room.id, 300_000, async () => {
    assertImageBudget([source.key]);
    const loaded = await load(source.key);
    if (!loaded) throw new Error("The design image is missing.");
    bytes = loaded;
  });
  void settleGeneration(
    owner,
    job.id,
    async () => {
      const prompt = buildFinalPrompt();
      const size = outputSize(bytes);
      const signal = AbortSignal.timeout(270_000);
      const result = await retryImageRequest(
        () =>
          generateImage({
            model: createOpenAI({ apiKey: ENV.OPENAI_API_KEY }).image(model),
            prompt: { text: prompt, images: [bytes] },
            size,
            providerOptions: {
              openai: { quality: finalImageSettings.quality, outputFormat: "png" },
            },
            n: 1,
            maxRetries: 0,
            abortSignal: signal,
          }),
        signal,
      );
      const id = crypto.randomUUID();
      const key = `${ownerPrefix(owner)}${room.id}/${id}.png`;
      const design: Design = {
        id,
        key,
        prompt: source.prompt,
        promptKey: promptKeyFor(key),
        createdAt: new Date().toISOString(),
        baseId: source.baseId,
        plan: source.plan,
        mode: "final",
        inferred: source.inferred,
        generation: {
          model,
          quality: finalImageSettings.quality,
          size,
          outputTokens: result.usage?.outputTokens,
          outputCostUsd: outputCost(model, result.usage?.outputTokens),
        },
      };
      return persistDesigns(
        owner,
        room.id,
        [design],
        [
          { key: design.key, bytes: Buffer.from(result.image.base64, "base64"), type: "image/png" },
          promptBlob(design, prompt),
        ],
      );
    },
    releaseWork,
  ).catch((error) => console.error("Could not settle final render job", error));
  return { jobId: job.id };
}

class ImageApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responseBody: string,
  ) {
    super(`The image edit failed (${statusCode}). ${responseBody.slice(0, 300)}`);
  }
}

export async function startEditGeneration(
  owner: string,
  input: {
    roomId: string;
    designId: string;
    prompt: string;
    mask: Uint8Array<ArrayBuffer>;
    assetIds?: string[];
  },
) {
  if (!ENV.OPENAI_API_KEY)
    throw new Error("Add OPENAI_API_KEY to the server environment to edit a design.");
  const room = (await rooms(owner)).find((r) => r.id === input.roomId);
  if (!room) throw new Response("Room not found", { status: 404 });
  const source = room.designs.find((d) => d.id === input.designId);
  if (!source) throw new Error("Design not found.");
  const refs = (input.assetIds ?? []).map((id) =>
    room.assets.find((a) => a.id === id && a.kind !== "room"),
  );
  if (refs.some((ref) => !ref))
    throw new Response("Choose references from this room.", { status: 400 });
  const references = refs.filter((ref) => !!ref);
  const type = mediaType(source.key);
  let sourceBytes!: Uint8Array;
  let size!: string;
  const refBytes: { bytes: Uint8Array; type: string }[] = [];
  const { job, releaseWork } = await admitJob(owner, room.id, 300_000, async () => {
    assertImageBudget([source.key, ...references.map((r) => r.key)], input.mask.byteLength);
    const loaded = await load(source.key);
    if (!loaded) throw new Error("The design image is missing.");
    sourceBytes = loaded;
    if (type !== "image/png") throw new Error("Only PNG designs can be brush-edited.");
    const dims = pngDimensions(sourceBytes);
    const mask = pngDimensions(input.mask);
    if (!dims || !mask || dims.width !== mask.width || dims.height !== mask.height)
      throw new Error("The mask must be a PNG with the same dimensions as the design.");
    // The mask only matches at the source's exact size.
    size = `${dims.width}x${dims.height}`;
    for (const ref of references) {
      const bytes = await load(ref.key);
      if (!bytes) throw new Error("A reference image is missing. Please upload it again.");
      refBytes.push({ bytes, type: mediaType(ref.key) });
    }
  });
  void settleGeneration(
    owner,
    job.id,
    async () => {
      const model = ENV.OPENAI_IMAGE_MODEL || defaultImageModel;
      // Keep the source's detail level so the edit does not degrade the rest of the image.
      const quality =
        source.generation?.quality ?? room.imageSettings?.quality ?? defaultImageSettings.quality;
      const prompt = buildEditPrompt(
        input.prompt,
        references.map((ref) => ({ name: ref.name, kind: ref.kind, dimensions: ref.dimensions })),
      );
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      const imageField = refBytes.length ? "image[]" : "image";
      form.append(
        imageField,
        new Blob([sourceBytes as Uint8Array<ArrayBuffer>], { type }),
        "design.png",
      );
      refBytes.forEach((ref, i) =>
        form.append(
          imageField,
          new Blob([ref.bytes as Uint8Array<ArrayBuffer>], { type: ref.type }),
          `reference-${i + 1}`,
        ),
      );
      form.set("mask", new Blob([input.mask], { type: "image/png" }), "mask.png");
      form.set("n", "1");
      form.set("size", size);
      form.set("quality", quality);
      form.set("output_format", "png");
      const signal = AbortSignal.timeout(270_000);
      const data = await retryImageRequest(async () => {
        const response = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${ENV.OPENAI_API_KEY}` },
          body: form,
          signal,
        });
        if (!response.ok) throw new ImageApiError(response.status, await response.text());
        return (await response.json()) as {
          data?: { b64_json?: string }[];
          usage?: { output_tokens?: number };
        };
      }, signal);
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error("The image edit returned no image.");
      const outputTokens = data.usage?.output_tokens;
      const key = `${ownerPrefix(owner)}${room.id}/${crypto.randomUUID()}.png`;
      const design: Design = {
        id: crypto.randomUUID(),
        key,
        prompt: input.prompt,
        promptKey: promptKeyFor(key),
        createdAt: new Date().toISOString(),
        baseId: source.baseId,
        mode: "edit",
        assetIds: references.length ? references.map((r) => r.id) : undefined,
        generation: {
          model,
          quality,
          size,
          outputTokens,
          outputCostUsd: outputCost(model, outputTokens),
        },
      };
      return persistDesigns(
        owner,
        room.id,
        [design],
        [
          { key: design.key, bytes: Buffer.from(b64, "base64"), type: "image/png" },
          promptBlob(design, prompt),
        ],
      );
    },
    releaseWork,
  ).catch((error) => console.error("Could not settle edit job", error));
  return { jobId: job.id };
}
export async function settleGeneration(
  owner: string,
  jobId: string,
  work: () => Promise<string>,
  releaseWork?: () => void,
) {
  try {
    finishJob(owner, jobId, { designId: await work() });
  } catch (error) {
    finishJob(owner, jobId, {
      error: generationError(error),
    });
  } finally {
    try {
      releaseGeneration(owner);
    } finally {
      releaseWork?.();
    }
  }
}
