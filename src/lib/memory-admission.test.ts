import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
vi.mock("ai", () => ({ generateImage: vi.fn() }));
vi.mock("./colmap-runner.server", () => ({
  reconstructionEngineAvailable: vi.fn(async () => true),
  runColmap: vi.fn(),
}));
import { generateImage } from "ai";
import { startGeneration, startEditGeneration } from "./generation.server";
import { startReconstruction } from "./reconstruction.server";
import {
  assertImageBudget,
  getJob,
  ownerPrefix,
  rooms,
  remove,
  saveRooms,
  save,
} from "./storage.server";
const directory = mkdtempSync(join(tmpdir(), "roomform-memory-"));
beforeAll(() => {
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("OPENAI_API_KEY", "test");
});
afterEach(() => vi.clearAllMocks());
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
async function fixture(owner: string) {
  const room = {
    id: crypto.randomUUID(),
    name: "Room",
    type: "Living room",
    notes: "",
    style: "",
    createdAt: "",
    assets: [0, 1].map((i) => ({
      id: crypto.randomUUID(),
      name: `Photo ${i}`,
      key: `${owner}-${i}.png`,
      kind: "room" as const,
    })),
    designs: [
      {
        id: crypto.randomUUID(),
        key: `${owner}-design.png`,
        baseId: "",
        createdAt: "",
        prompt: "",
      },
    ],
  };
  for (const asset of room.assets) await save(asset.key, new Uint8Array([1]), "image/png");
  await saveRooms(owner, [room]);
  return room;
}
const image = (byte: number) => ({ base64: Buffer.from([byte]).toString("base64") });

// The other user's images are deliberately missing: admission must fail before
// blob reads, brush validation or a paid provider call can allocate memory.
it("shares admission across users, brush edits and 3D builds before loading images", async () => {
  const first = await fixture("first"),
    other = await fixture("other");
  remove(other.assets[0].key);
  let complete!: (value: unknown) => void;
  vi.mocked(generateImage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = (value) => resolve(value as never);
      }) as never,
  );
  const input = {
    roomId: first.id,
    notes: "",
    style: "",
    assetIds: [],
    mode: "freestyle" as const,
  };
  const { jobId } = await startGeneration("first", input);
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  await expect(
    startGeneration("other", {
      ...input,
      roomId: other.id,
      baseId: other.assets[0].id,
      mode: "redesign",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    startEditGeneration("other", {
      roomId: other.id,
      designId: other.designs[0].id,
      prompt: "Edit",
      mask: new Uint8Array([1]),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(startReconstruction("other", { roomId: other.id })).rejects.toMatchObject({
    status: 409,
  });
  expect(generateImage).toHaveBeenCalledTimes(1);
  complete({ image: image(1) });
  await vi.waitFor(() => expect(getJob("first", jobId)?.status).toBe("succeeded"));
  vi.mocked(generateImage).mockResolvedValueOnce({ image: image(2) } as never);
  const next = await startGeneration("other", { ...input, roomId: other.id });
  await vi.waitFor(() => expect(getJob("other", next.jobId)?.status).toBe("succeeded"));
});

// A later paid request failing must not leave orphaned intermediate PNGs or
// publish a partial batch as a successful job.
it("saves each image before the next call and cleans up a failed serial batch", async () => {
  const room = await fixture("batch-failure");
  const db = new DatabaseSync(join(directory, "roomform.sqlite"));
  const prefix = `${ownerPrefix("batch-failure")}${room.id}/`;
  const count = () =>
    Number(
      db
        .prepare("SELECT count(*) AS n FROM objects WHERE substr(key,1,?)=?")
        .get(prefix.length, prefix)!.n,
    );
  vi.mocked(generateImage)
    .mockResolvedValueOnce({ image: image(4) } as never)
    .mockImplementationOnce(async () => {
      expect(count()).toBe(1);
      throw new Error("Provider unavailable");
    });
  try {
    const { jobId } = await startGeneration("batch-failure", {
      roomId: room.id,
      notes: "",
      style: "",
      assetIds: [],
      mode: "freestyle",
      count: 2,
    });
    await vi.waitFor(() => expect(getJob("batch-failure", jobId)?.status).toBe("failed"));
    expect(getJob("batch-failure", jobId)?.error).toBe("Provider unavailable");
    expect(count()).toBe(0);
    expect((await rooms("batch-failure"))[0].designs).toEqual(room.designs);
    vi.mocked(generateImage).mockResolvedValueOnce({ image: image(5) } as never);
    const next = await startGeneration("batch-failure", {
      roomId: room.id,
      notes: "",
      style: "",
      assetIds: [],
      mode: "freestyle",
    });
    await vi.waitFor(() => expect(getJob("batch-failure", next.jobId)?.status).toBe("succeeded"));
  } finally {
    db.close();
  }
});

// SQLite zeroblob creates an oversized stored input without allocating it in JS.
it("enforces the aggregate input budget from blob lengths including extra in-memory bytes", () => {
  const db = new DatabaseSync(join(directory, "roomform.sqlite"));
  try {
    db.prepare("INSERT INTO objects VALUES (?,zeroblob(?),'image/png')").run("large", 32_000_000);
    expect(() => assertImageBudget(["large"])).not.toThrow();
    expect(() => assertImageBudget(["large"], 1)).toThrow("32 MB");
    expect(() => assertImageBudget(["missing"])).toThrow("missing");
  } finally {
    db.close();
  }
});
