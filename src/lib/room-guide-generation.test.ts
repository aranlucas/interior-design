import { buildPrompt } from "./generation-prompts";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleAiRoomLayout } from "./ai-room-layout.fixture";
import { designInput } from "./validation";
import type { Room, Asset } from "./types";

const directory = mkdtempSync(join(tmpdir(), "roomform-guide-"));
const output = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRe8AAAAASUVORK5CYII=",
  "base64",
);
// A bounded JPEG header suffices for dimension validation and multipart serialization.
const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 4, 0, 6, 0, 0, 255, 217]);
beforeAll(() => {
  process.env.DATA_DIR = directory;
  process.env.OPENAI_API_KEY = "test-key";
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function fixture() {
  const s = await import("./storage.server");
  const owner = crypto.randomUUID(),
    roomId = crypto.randomUUID(),
    resultId = crypto.randomUUID();
  const prefix = `${s.ownerPrefix(owner)}${roomId}/`;
  const assets: Asset[] = ["room", "room", "product", "inspiration"].map((kind, i) => ({
    id: crypto.randomUUID(),
    key: `${prefix}${i}.png`,
    name: `Reference ${i}`,
    kind: kind as Asset["kind"],
    ...(i === 2 ? { dimensions: "100 × 40 × 80 cm" } : {}),
  }));
  for (const [i, asset] of assets.entries())
    await s.save(asset.key, new Uint8Array([...output, i]), "image/png");
  const sourcePhotoIds = [assets[1].id, assets[0].id]; // Evidence order differs from the selected base.
  const room: Room = {
    id: roomId,
    name: "Test room",
    type: "Bedroom",
    notes: "",
    style: "",
    assets,
    designs: [
      {
        id: crypto.randomUUID(),
        key: `${prefix}previous.png`,
        prompt: "Old",
        createdAt: "",
        baseId: assets[0].id,
      },
    ],
    createdAt: "",
    reconstruction: {
      id: crypto.randomUUID(),
      status: "succeeded",
      stage: "Ready",
      photoIds: sourcePhotoIds,
      createdAt: "",
      updatedAt: "",
      mode: "ai-layout",
      result: {
        id: resultId,
        key: `${prefix}layout.json`,
        kind: "ai-layout",
        photoIds: sourcePhotoIds,
        sourcePhotoIds,
        registeredIds: [],
        pointCount: 0,
        components: 1,
      },
    },
  };
  await s.save(room.designs[0].key, new Uint8Array([...output, 4]), "image/png");
  await s.save(
    room.reconstruction!.result!.key,
    JSON.stringify({
      version: 1,
      kind: "ai-layout",
      sourcePhotoIds,
      layout: exampleAiRoomLayout(),
    }),
    "application/json",
  );
  await s.saveRooms(owner, [room]);
  const input = designInput.parse({
    roomId,
    baseId: assets[0].id,
    notes: "A calm bedroom with oak furniture.",
    style: "Japandi",
    assetIds: [assets[3].id, assets[2].id],
    measurements: "4 × 6 m",
    mode: "stage",
    people: "dog",
    lighting: "evening",
    previousDesignId: room.designs[0].id,
    roomGuide: {
      resultId,
      image: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`,
      camera: { position: [8, 6, 9], target: [2, 1, 3], fov: 40, aspect: 1.5 },
      showInferred: false,
      showFixtures: true,
    },
  });
  return { s, owner, room, input, assets, sourcePhotoIds };
}

it("sends the actual 3D image first through the installed SDK, then ordered source photos, selected refs and prior design, and retains provenance", async () => {
  const { s, owner, room, input, assets, sourcePhotoIds } = await fixture();
  let form: FormData | undefined;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://api.openai.com/v1/images/edits");
    form = init?.body as FormData;
    return Response.json({ created: 1, data: [{ b64_json: output.toString("base64") }] });
  });
  const { startGeneration } = await import("./generation.server");
  const { jobId } = await startGeneration(owner, input);
  await vi.waitFor(() => expect(s.getJob(owner, jobId)?.status).toBe("succeeded"));
  expect(fetch).toHaveBeenCalledTimes(1); // Saved 3D constraints replace the photo geometry pre-pass.
  expect(form).toBeInstanceOf(FormData);
  const files = [...form!.values()].filter((value): value is File => value instanceof File);
  const bytes = await Promise.all(
    files.map(async (file) => new Uint8Array(await file.arrayBuffer())),
  );
  expect(bytes).toEqual([jpeg, ...[1, 0, 3, 2, 4].map((i) => new Uint8Array([...output, i]))]);
  expect(form!.get("size")).toBe("3520x2336");
  expect(form!.get("quality")).toBe("max");
  expect(form!.get("output_format")).toBe("png");
  expect(form!.get("n")).toBe("1");
  const prompt = String(form!.get("prompt"));
  for (const text of [
    "Image 1 is the client's chosen 3D",
    "Images 2 through 3",
    "Image 4: inspiration",
    "Image 5: product",
    "photoNumber 1 is image 2",
    "not as the output camera",
    "NOT measurements",
    "4 × 6 m",
    "oak furniture",
    "Japandi",
    "a dog",
    "evening",
    "100",
    "geometry",
    "previous design",
    "inferred",
    "Do not mirror",
    "Preserve its furniture identities, quantities, materials, physical proportions, and relative placement",
    "not several",
    "Client-confirmed physical size: 100 × 40 × 80 cm",
    "do not duplicate",
    "not its background or camera",
    "Do not return an eye-level interior photograph",
    "room silhouette",
  ])
    expect(prompt).toContain(text);
  expect(prompt).toContain(JSON.stringify(exampleAiRoomLayout()));
  const design = (await s.rooms(owner))[0].designs[0];
  expect(design.guide).toMatchObject({
    resultId: input.roomGuide!.resultId,
    camera: input.roomGuide!.camera,
    photoIds: sourcePhotoIds,
    assetIds: [assets[3].id, assets[2].id],
    showInferred: false,
    style: "Japandi",
    previousDesignId: input.previousDesignId,
  });
  expect(design.prompt).toBe(input.notes);
  expect(await s.load(design.guide!.key)).toEqual(jpeg);
  const snapshot = JSON.parse(Buffer.from((await s.load(design.guide!.layoutKey))!).toString());
  expect(snapshot.layout).toEqual(exampleAiRoomLayout());
  // Rebuilding can remove the live result without erasing a design's input evidence.
  s.remove(room.reconstruction!.result!.key);
  expect(await s.load(design.guide!.layoutKey)).not.toBeNull();
  const { deleteDesign } = await import("./room-actions.server");
  await deleteDesign(owner, room.id, design.id);
  for (const key of [design.key, design.guide!.key, design.guide!.layoutKey])
    expect(await s.load(key)).toBeNull();
});

it("rejects foreign room/result/reference IDs, stale photos, replaced/running/sparse results and missing evidence before calling the provider", async () => {
  const { s, owner, room, input } = await fixture();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Must not call provider"));
  const { startGeneration } = await import("./generation.server");
  await expect(startGeneration("foreign-owner", input)).rejects.toMatchObject({ status: 404 });
  await expect(
    startGeneration(owner, { ...input, assetIds: [crypto.randomUUID()] }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    startGeneration(owner, {
      ...input,
      roomGuide: { ...input.roomGuide!, resultId: crypto.randomUUID() },
    }),
  ).rejects.toMatchObject({ status: 409 });
  for (const change of [
    (r: Room) => {
      r.assets = r.assets.filter((a) => a.id !== r.assets[1].id);
    },
    (r: Room) => {
      r.reconstruction!.status = "running";
    },
    (r: Room) => {
      r.reconstruction!.result!.kind = "sparse";
    },
    (r: Room) => {
      r.reconstruction!.result!.key = "users/foreign/layout.json";
    },
    (r: Room) => {
      r.reconstruction!.result!.sourcePhotoIds = [crypto.randomUUID()];
    },
  ]) {
    const edited = structuredClone(room);
    change(edited);
    await s.saveRooms(owner, [edited]);
    await expect(startGeneration(owner, input)).rejects.toBeInstanceOf(Response);
  }
  await s.saveRooms(owner, [room]);
  s.remove(room.reconstruction!.result!.key);
  await expect(startGeneration(owner, input)).rejects.toMatchObject({ status: 404 });
  expect(fetch).not.toHaveBeenCalled();
  expect(s.claimGeneration(owner)).toBe(true);
  s.releaseGeneration(owner);
});

it("rejects malformed, oversized, mismatched-aspect guide images and invalid cameras", async () => {
  const { owner, input } = await fixture();
  const { startGeneration } = await import("./generation.server");
  for (const image of [
    "data:image/png;base64,AAAA",
    "data:image/jpeg;base64," + "A".repeat(3_400_000),
  ])
    expect(
      designInput.safeParse({ ...input, roomGuide: { ...input.roomGuide, image } }).success,
    ).toBe(false);
  for (const camera of [
    { ...input.roomGuide!.camera, fov: 0 },
    { ...input.roomGuide!.camera, position: input.roomGuide!.camera.target },
  ])
    expect(
      designInput.safeParse({ ...input, roomGuide: { ...input.roomGuide, camera } }).success,
    ).toBe(false);
  await expect(
    startGeneration(owner, {
      ...input,
      roomGuide: { ...input.roomGuide!, image: "data:image/jpeg;base64,AAAA" },
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    startGeneration(owner, {
      ...input,
      roomGuide: { ...input.roomGuide!, camera: { ...input.roomGuide!.camera, aspect: 1 } },
    }),
  ).rejects.toMatchObject({ status: 400 });
});

it("keeps photo generation's base/context/reference/prior order and geometry pre-pass", async () => {
  const { s, owner, input, assets } = await fixture();
  const layout = await import("./layout.server");
  const analyze = vi.spyOn(layout, "analyzeLayout").mockResolvedValue("Keep the window clear.");
  let form: FormData | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    form = init?.body as FormData;
    return Response.json({ created: 1, data: [{ b64_json: output.toString("base64") }] });
  });
  const { startGeneration } = await import("./generation.server");
  const { jobId } = await startGeneration(owner, { ...input, roomGuide: undefined, count: 2 });
  await vi.waitFor(() => expect(s.getJob(owner, jobId)?.status).toBe("succeeded"));
  expect(analyze).toHaveBeenCalledWith(
    expect.objectContaining({ baseImage: new Uint8Array([...output, 0]) }),
  );
  const files = [...form!.values()].filter((value): value is File => value instanceof File);
  expect(
    await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer()))),
  ).toEqual([0, 1, 3, 2, 4].map((i) => new Uint8Array([...output, i])));
  expect(form!.get("n")).toBe("2");
  expect(String(form!.get("prompt"))).toContain("Keep the window clear.");
  expect(String(form!.get("prompt"))).toContain("Image 3: inspiration");
  const design = (await s.rooms(owner))[0].designs[0];
  expect(design.baseId).toBe(assets[0].id);
  expect(design.guide).toBeUndefined();
});

it("allows a retained layout after a failed rebuild and leaves no guide objects on provider failure", async () => {
  const { s, owner, room, input } = await fixture();
  room.reconstruction!.status = "failed";
  await s.saveRooms(owner, [room]);
  const before = room.designs.length;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ error: { message: "Test service failure" } }, { status: 400 }),
    );
  const { startGeneration } = await import("./generation.server");
  const { jobId } = await startGeneration(owner, input);
  await vi.waitFor(() => expect(s.getJob(owner, jobId)?.status).toBe("failed"));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await s.rooms(owner))[0].designs).toHaveLength(before);
  expect(s.claimGeneration(owner)).toBe(true);
  s.releaseGeneration(owner);
});

it("separates product identity, style inspiration, and estimated placement without treating empty mode as furnishing", async () => {
  const { input } = await fixture();
  const constraints = {
    layout: exampleAiRoomLayout(),
    capture: input.roomGuide!,
  };
  const refs = [
    { name: "Oak table", kind: "product", dimensions: "100 × 40 × 80 cm" },
    { name: "Warm minimal room", kind: "inspiration" },
  ];
  for (const mode of ["redesign", "stage", "sketch"] as const) {
    const prompt = buildPrompt("a bedroom", { ...input, mode }, refs, 3, undefined, constraints);
    expect(prompt).toContain("Image 4: product, Oak table.");
    expect(prompt).not.toContain("Return only a polished interior photograph");
    expect(prompt).toContain("Final camera check:");
    expect(prompt).toContain("Client-confirmed physical size: 100 × 40 × 80 cm");
    expect(prompt).toContain("Image 5: inspiration, Warm minimal room.");
    expect(prompt).toContain("Inspiration references supply palette, mood, and styling only");
    expect(prompt).toContain("Client-confirmed product dimensions override estimated box sizes");
    expect(prompt).toContain("A replacement occupies the replaced item's location and orientation");
    expect(prompt).toContain("Never shrink, stretch, crop away, or push furniture through walls");
    expect(prompt).toContain("showFixtures=false hides boxes for inspection");
    expect(prompt.indexOf("Before returning, visually check")).toBeGreaterThan(
      prompt.indexOf("Style direction:"),
    );
  }
  const empty = buildPrompt(
    "a bedroom",
    { ...input, mode: "empty" },
    refs,
    3,
    undefined,
    constraints,
  );
  expect(empty).toContain("remove movable furnishings, retain permanent fixtures");
  expect(empty).not.toContain("Return only a polished photograph");
  expect(empty).toContain("Final camera check:");
  expect(empty).toContain("Remove movable furniture even when it appears as a box");
  expect(empty).not.toContain("Product references specify the exact furniture identity");
  expect(empty).not.toContain("Furniture placement rules:");
  expect(empty).not.toContain("Before returning, visually check each requested product");
});
