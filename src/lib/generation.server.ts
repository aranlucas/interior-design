import { ENV } from "varlock/env";
import { createOpenAI } from "@ai-sdk/openai";
import { generateImage } from "ai";
import {
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
import { buildPrompt, buildEditPrompt, isOutdoor } from "./generation-prompts";
import { outputSize, orientationSize, pngDimensions } from "./image-size";
import { analyzeLayout } from "./layout.server";
import { assertCurrentGuide, prepareRoomGuide } from "./room-guide.server";
import { defaultImageModel, defaultImageSettings, outputCost } from "./image-settings";
import { generationError, retryImageRequest } from "./image-errors.server";

import type { z } from "zod";
function mediaType(key: string) {
  return key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
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
  const refs = input.assetIds
    .map((id) => room.assets.find((a) => a.id === id && a.kind !== "room"))
    .filter((a) => !!a);
  if (refs.length !== input.assetIds.length)
    throw new Response("Choose references from this room.", { status: 400 });
  const previous = input.previousDesignId
    ? room.designs.find((d) => d.id === input.previousDesignId)
    : undefined;
  if (input.previousDesignId && !previous) throw new Error("Previous design not found.");
  const guide = input.roomGuide ? await prepareRoomGuide(owner, room, input.roomGuide) : undefined;
  const originalPhotos = guide ? guide.photos : base ? [base, ...context] : [];
  const ordered = [...originalPhotos, ...refs];
  const images = await Promise.all(
    ordered.map(async (a) => {
      const b = await load(a.key);
      if (!b) throw new Error("A reference image is missing. Please upload it again.");
      return b;
    }),
  );
  if (guide) images.unshift(guide.image);
  const count = input.count ?? 1;
  const ttl = count >= 8 ? 600_000 : count > 1 ? 480_000 : 300_000;
  if (!claimGeneration(u.sub, ttl))
    throw new Error("A design is already being generated. Please wait for it to finish.");
  let job;
  try {
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
    releaseGeneration(u.sub);
    throw error;
  }
  void settleGeneration(u.sub, job.id, async () => {
    const current = (await rooms(u.sub)).find((r) => r.id === room.id);
    if (!current) throw new Error("Room was removed before generation started.");
    if (input.roomGuide) assertCurrentGuide(current, input.roomGuide.resultId);
    const plan =
      guide || !base || input.mode === "freestyle" || isOutdoor(room.type)
        ? null
        : await analyzeLayout({
            mode: input.mode,
            baseImage: images[0],
            mediaType: mediaType(base.key),
            roomType: room.type === "Other" ? "room" : room.type.toLowerCase(),
            references: refs.map((r) => ({ name: r.name, kind: r.kind, dimensions: r.dimensions })),
            measurements: input.measurements,
            style: input.style,
            brief: input.notes,
          });
    let prompt = buildPrompt(
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
      prompt += guide
        ? " The final image is the previous design. Preserve its furniture identities, quantities, materials, physical proportions, and relative placement unless the client brief explicitly requests a change. Carry those choices into the chosen camera rather than copying the previous image's screen coordinates. Image 1 remains the chosen camera/layout guide and the original room photos remain appearance evidence. In empty mode, remove movable furnishings regardless of the previous design."
        : base
          ? " The final image is the previous design. Make only the changes requested in the client brief, preserving its furniture identities, quantities, materials, and placement unless a change is requested or required by the selected task. Keep image 1 as the architectural and camera authority; preserve its crop, viewpoint, and perspective."
          : "";
    }
    if (input.fillGaps) {
      prompt +=
        " This is an optional AI finish of a partial photo reconstruction. Keep architecture and contents visible in the original photos consistent across views. Fill visual gaps conservatively without claiming inferred areas were observed or measured. This output does not add measured geometry to the 3D reconstruction.";
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
    const signal = AbortSignal.timeout(ttl - 30_000);
    const result = await retryImageRequest(
      () =>
        generateImage({
          model: provider.image(model),
          prompt: { text: prompt, images },
          size,
          providerOptions: { openai: { quality: settings.quality, outputFormat: "png" } },
          n: count,
          maxRetries: 0,
          abortSignal: signal,
        }),
      signal,
    );
    const produced = result.images?.length ? result.images : [result.image];
    const createdAt = new Date().toISOString();
    const designs = produced.map(() => {
      const id = crypto.randomUUID();
      return {
        id,
        key: `${ownerPrefix(u.sub)}${room.id}/${id}.png`,
        prompt: input.notes,
        createdAt,
        baseId: base?.id ?? "",
        plan: plan || undefined,
        mode: input.mode,
        inferred: input.fillGaps || undefined,
        generation: {
          model,
          quality: settings.quality,
          size,
          outputTokens: produced.length === 1 ? result.usage?.outputTokens : undefined,
          outputCostUsd:
            produced.length === 1 ? outputCost(model, result.usage?.outputTokens) : undefined,
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
    });
    try {
      for (const [index, design] of designs.entries()) {
        // The SDK's uint8Array getter decodes through a JS string iterator, whose
        // transient allocations can exceed our memory limit for a single 4K PNG.
        // Decode natively without caching another full-size image on the result.
        await save(design.key, Buffer.from(produced[index].base64, "base64"), "image/png");
        if (design.guide && guide) {
          await save(design.guide.key, guide.image, "image/jpeg");
          await save(design.guide.layoutKey, guide.snapshot, "application/json");
        }
      }
      const target = await mutateRooms(u.sub, (latest) => {
        const target = latest.find((r) => r.id === room.id);
        if (!target) throw new Error("Room was removed during generation.");
        target.designs.unshift(...designs);
        return target;
      });
      return target.designs[0].id;
    } catch (error) {
      for (const design of designs) {
        for (const key of [design.key, design.guide?.key, design.guide?.layoutKey]) {
          if (key) remove(key);
        }
      }
      throw error;
    }
  }).catch((error) => console.error("Could not settle generation job", error));
  return { jobId: job.id };
}
export async function startEditGeneration(
  owner: string,
  input: { roomId: string; designId: string; prompt: string; mask: Uint8Array<ArrayBuffer> },
) {
  const u = { sub: owner };
  if (!ENV.OPENAI_API_KEY)
    throw new Error("Add OPENAI_API_KEY to the server environment to edit a design.");
  const all = await rooms(u.sub);
  const room = all.find((r) => r.id === input.roomId);
  if (!room) throw new Response("Room not found", { status: 404 });
  const source = room.designs.find((d) => d.id === input.designId);
  if (!source) throw new Error("Design not found.");
  const sourceBytes = await load(source.key);
  if (!sourceBytes) throw new Error("The design image is missing.");
  const type = mediaType(source.key);
  if (type !== "image/png") throw new Error("Only PNG designs can be brush-edited.");
  const dims = pngDimensions(sourceBytes);
  const mask = pngDimensions(input.mask);
  if (!dims || !mask || dims.width !== mask.width || dims.height !== mask.height)
    throw new Error("The mask must be a PNG with the same dimensions as the design.");
  if (!claimGeneration(u.sub, 300_000))
    throw new Error("A design is already being generated. Please wait for it to finish.");
  let job;
  try {
    job = createJob(u.sub, room.id);
  } catch (error) {
    releaseGeneration(u.sub);
    throw error;
  }
  void settleGeneration(u.sub, job.id, async () => {
    const form = new FormData();
    form.set("model", ENV.OPENAI_IMAGE_MODEL || defaultImageModel);
    form.set("prompt", buildEditPrompt(input.prompt));
    form.set("image", new Blob([new Uint8Array(sourceBytes)], { type }), "design.png");
    form.set("mask", new Blob([input.mask], { type: "image/png" }), "mask.png");
    form.set("n", "1");
    form.set("output_format", "png");
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${ENV.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(270_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`The image edit failed (${response.status}). ${detail.slice(0, 300)}`);
    }
    const data = (await response.json()) as { data?: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("The image edit returned no image.");
    const bytes = Buffer.from(b64, "base64");
    const design = {
      id: crypto.randomUUID(),
      key: `${ownerPrefix(u.sub)}${room.id}/${crypto.randomUUID()}.png`,
      prompt: input.prompt,
      createdAt: new Date().toISOString(),
      baseId: source.baseId,
      mode: "edit",
    };
    try {
      await save(design.key, bytes, "image/png");
      await mutateRooms(u.sub, (latest) => {
        const target = latest.find((r) => r.id === room.id);
        if (!target) throw new Error("Room was removed during generation.");
        target.designs.unshift(design);
        return target;
      });
      return design.id;
    } catch (error) {
      remove(design.key);
      throw error;
    }
  }).catch((error) => console.error("Could not settle edit job", error));
  return { jobId: job.id };
}
export async function settleGeneration(owner: string, jobId: string, work: () => Promise<string>) {
  try {
    finishJob(owner, jobId, { designId: await work() });
  } catch (error) {
    finishJob(owner, jobId, {
      error: generationError(error),
    });
  } finally {
    releaseGeneration(owner);
  }
}
