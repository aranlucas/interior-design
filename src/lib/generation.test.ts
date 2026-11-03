import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("ai", () => ({ generateImage: vi.fn() }));
import { generateImage } from "ai";
function generatedImage(bytes: number[]) {
  return {
    base64: Buffer.from(bytes).toString("base64"),
    get uint8Array(): Uint8Array {
      throw new Error("Do not use the SDK's allocation-heavy image decoder.");
    },
  };
}
const directory = mkdtempSync(join(tmpdir(), "roomform-jobs-"));
beforeAll(() => {
  process.env.DATA_DIR = directory;
  process.env.OPENAI_API_KEY = "test";
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
it("persists a paid result after POST returns, scopes status, and releases the lease", async () => {
  const s = await import("./storage.server");
  const { startGeneration } = await import("./generation.server");
  const owner = "jobs-success";
  const roomId = crypto.randomUUID();
  const baseId = crypto.randomUUID();
  const key = s.ownerPrefix(owner) + roomId + "/base.jpeg";
  await s.save(key, new Uint8Array([1]), "image/jpeg");
  await s.saveRooms(owner, [
    {
      id: roomId,
      name: "Room",
      type: "Living",
      notes: "",
      style: "",
      assets: [{ id: baseId, key, name: "Base", kind: "room" }],
      designs: [],
      createdAt: new Date().toISOString(),
    },
  ]);
  let complete!: (value: unknown) => void;
  vi.mocked(generateImage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = (value) => resolve(value as Awaited<ReturnType<typeof generateImage>>);
      }) as ReturnType<typeof generateImage>,
  );
  const { jobId } = await startGeneration(owner, {
    roomId,
    baseId,
    notes: "",
    style: "",
    assetIds: [],
  });
  expect(s.getJob(owner, jobId)?.status).toBe("running");
  expect(s.getJob("other", jobId)).toBeUndefined();
  await expect(
    startGeneration(owner, { roomId, baseId, notes: "", style: "", assetIds: [] }),
  ).rejects.toThrow("already");
  await s.mutateRooms(owner, (all) => {
    all[0].notes = "Edited while generating";
  });
  expect(vi.mocked(generateImage).mock.calls[0][0]).toMatchObject({
    size: "3840x2160",
    providerOptions: { openai: { quality: "max", outputFormat: "png" } },
    maxRetries: 0,
  });
  complete({ image: generatedImage([1, 2]), usage: { outputTokens: 13000 } });
  await vi.waitFor(() => expect(s.getJob(owner, jobId)?.status).toBe("succeeded"));
  const job = s.getJob(owner, jobId)!;
  expect((await s.rooms(owner))[0].designs[0].id).toBe(job.designId);
  expect(await s.load((await s.rooms(owner))[0].designs[0].key)).toEqual(new Uint8Array([1, 2]));
  expect((await s.rooms(owner))[0].notes).toBe("Edited while generating");
  expect((await s.rooms(owner))[0].designs[0].generation).toMatchObject({
    model: "gpt-image-2.5-sunburst",
    quality: "max",
    size: "3840x2160",
    outputTokens: 13000,
    outputCostUsd: 0.39,
  });
  expect(s.claimGeneration(owner)).toBe(true);
  s.releaseGeneration(owner);
  vi.mocked(generateImage).mockRejectedValueOnce(new Error("Provider failed"));
  const failed = await startGeneration(owner, {
    roomId,
    baseId,
    notes: "",
    style: "",
    assetIds: [],
  });
  await vi.waitFor(() => expect(s.getJob(owner, failed.jobId)?.status).toBe("failed"));
  expect(s.getJob(owner, failed.jobId)?.error).toBe("Provider failed");
  expect(s.claimGeneration(owner)).toBe(true);
  s.releaseGeneration(owner);
});
it("recovers interrupted jobs and leases when a new server opens the database", async () => {
  const s = await import("./storage.server");
  expect(s.claimGeneration("restart")).toBe(true);
  const job = s.createJob("restart", crypto.randomUUID());
  const done = s.createJob("completed", crypto.randomUUID());
  s.finishJob("someone-else", done.id, { error: "Wrong owner" });
  expect(s.getJob("completed", done.id)?.status).toBe("running");
  s.finishJob("completed", done.id, { designId: "finished-design" });
  s.finishJob("completed", done.id, { error: "Late failure" });
  expect(s.getJob("completed", done.id)?.status).toBe("succeeded");
  vi.resetModules();
  const restarted = await import("./storage.server");
  expect(restarted.getJob("restart", job.id)?.status).toBe("failed");
  expect(restarted.getJob("restart", job.id)?.error).toContain("restart");
  expect(restarted.claimGeneration("restart")).toBe(true);
  expect(restarted.getJob("completed", done.id)?.status).toBe("succeeded");
});
function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
it("edits a design with a brush mask through the OpenAI edits endpoint", async () => {
  const s = await import("./storage.server");
  const { startEditGeneration } = await import("./generation.server");
  const owner = "edit";
  const roomId = crypto.randomUUID();
  const designId = crypto.randomUUID();
  const key = s.ownerPrefix(owner) + roomId + "/" + designId + ".png";
  await s.save(key, png(1024, 1536), "image/png");
  await s.saveRooms(owner, [
    {
      id: roomId,
      name: "Room",
      type: "Living",
      notes: "",
      style: "",
      assets: [],
      designs: [{ id: designId, key, prompt: "", baseId: "", createdAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    },
  ]);
  const fetchMock = vi.fn(async () =>
    Response.json({ data: [{ b64_json: Buffer.from([9, 9]).toString("base64") }] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { jobId } = await startEditGeneration(owner, {
      roomId,
      designId,
      prompt: "Replace the rug",
      mask: new Uint8Array(png(1024, 1536).buffer),
    });
    await vi.waitFor(() => expect(s.getJob(owner, jobId)?.status).toBe("succeeded"));
    const room = (await s.rooms(owner))[0];
    expect(room.designs).toHaveLength(2);
    expect(room.designs[0].mode).toBe("edit");
    expect(room.designs[0].prompt).toBe("Replace the rug");
    expect(room.designs[0].baseId).toBe("");
    expect(await s.load(room.designs[0].key)).toEqual(new Uint8Array([9, 9]));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    const prompt = String(form.get("prompt"));
    expect(prompt).toContain("Replace the rug");
    expect(prompt).toContain("outside the mask");
    expect(form.get("n")).toBe("1");
    const image = form.get("image") as File;
    expect(image.type).toBe("image/png");
    expect(image.size).toBe(24);
    expect((form.get("mask") as File).type).toBe("image/png");
  } finally {
    vi.unstubAllGlobals();
  }
  expect(s.claimGeneration(owner)).toBe(true);
  s.releaseGeneration(owner);
});
it("rejects a brush mask whose dimensions differ from the design", async () => {
  const s = await import("./storage.server");
  const { startEditGeneration } = await import("./generation.server");
  const owner = "edit-mismatch";
  const roomId = crypto.randomUUID();
  const designId = crypto.randomUUID();
  const key = s.ownerPrefix(owner) + roomId + "/" + designId + ".png";
  await s.save(key, png(1024, 1536), "image/png");
  await s.saveRooms(owner, [
    {
      id: roomId,
      name: "Room",
      type: "Living",
      notes: "",
      style: "",
      assets: [],
      designs: [{ id: designId, key, prompt: "", baseId: "", createdAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    },
  ]);
  await expect(
    startEditGeneration(owner, {
      roomId,
      designId,
      prompt: "Replace the rug",
      mask: new Uint8Array(png(100, 100).buffer),
    }),
  ).rejects.toThrow("same dimensions");
});
it("ignores the base photo in freestyle mode", async () => {
  const s = await import("./storage.server");
  const { startGeneration } = await import("./generation.server");
  const owner = "freestyle-photos";
  const roomId = crypto.randomUUID();
  const baseId = crypto.randomUUID();
  const key = s.ownerPrefix(owner) + roomId + "/base.jpeg";
  await s.save(key, new Uint8Array([1]), "image/jpeg");
  await s.saveRooms(owner, [
    {
      id: roomId,
      name: "Room",
      type: "Living room",
      notes: "",
      style: "",
      assets: [{ id: baseId, key, name: "Base", kind: "room" }],
      designs: [],
      createdAt: new Date().toISOString(),
    },
  ]);
  vi.mocked(generateImage).mockResolvedValueOnce({
    image: generatedImage([1, 2]),
  } as never);
  const { jobId } = await startGeneration(owner, {
    roomId,
    baseId,
    notes: "",
    style: "",
    assetIds: [],
    mode: "freestyle",
    orientation: "portrait",
  });
  await vi.waitFor(() => expect(s.getJob(owner, jobId)?.status).toBe("succeeded"));
  const design = (await s.rooms(owner))[0].designs[0];
  expect(design.baseId).toBe("");
  expect(design.mode).toBe("freestyle");
  const call = vi.mocked(generateImage).mock.calls.at(-1)![0] as {
    size: string;
    prompt: { images: unknown[] };
  };
  expect(call.size).toBe("1024x1536");
  expect(call.prompt.images).toHaveLength(0);
  s.releaseGeneration(owner);
});

it("keeps all variations without duplicating request-level token charges on each design", async () => {
  const s = await import("./storage.server");
  const { startGeneration } = await import("./generation.server");
  const owner = "variations-settings";
  const roomId = crypto.randomUUID();
  await s.saveRooms(owner, [
    {
      id: roomId,
      name: "Garden",
      type: "Garden",
      notes: "",
      style: "Tropical",
      assets: [],
      designs: [],
      createdAt: new Date().toISOString(),
    },
  ]);
  vi.mocked(generateImage).mockResolvedValueOnce({
    images: Array.from({ length: 4 }, (_, i) => generatedImage([i])),
    usage: { outputTokens: 52000 },
  } as never);
  const imageSettings = { quality: "high", size: "photo" } as const;
  const { jobId } = await startGeneration(owner, {
    roomId,
    notes: "",
    style: "Tropical",
    assetIds: [],
    mode: "freestyle",
    orientation: "square",
    count: 4,
    imageSettings,
  });
  await vi.waitFor(() => expect(s.getJob(owner, jobId)?.status).toBe("succeeded"));
  const room = (await s.rooms(owner))[0];
  expect(room.imageSettings).toEqual(imageSettings);
  expect(room.designs).toHaveLength(4);
  expect(new Set(room.designs.map((design) => design.key)).size).toBe(4);
  expect(vi.mocked(generateImage).mock.calls.at(-1)![0]).toMatchObject({
    n: 4,
    size: "1024x1024",
    providerOptions: { openai: { quality: "high" } },
  });
  for (const [index, design] of room.designs.entries()) {
    expect(design.generation).toMatchObject({ quality: "high", size: "1024x1024" });
    expect(design.generation?.outputTokens).toBeUndefined();
    expect(design.generation?.outputCostUsd).toBeUndefined();
    expect(await s.load(design.key)).toEqual(new Uint8Array([index]));
  }
});
