import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("./colmap-runner.server", () => ({
  reconstructionEngineAvailable: vi.fn(async () => true),
  runColmap: vi.fn(),
}));
vi.mock("./ai-room-layout.server", () => ({ runAiRoomLayout: vi.fn() }));
import { runColmap } from "./colmap-runner.server";
import { runAiRoomLayout } from "./ai-room-layout.server";
import { exampleAiRoomLayout } from "./ai-room-layout.fixture";
import {
  reconstructionRoom,
  startReconstruction,
  cancelRoomReconstruction,
} from "./reconstruction.server";
import { rooms, save, saveRooms, load, mutateRooms } from "./storage.server";
import type { ReconstructedScene } from "./reconstruction";
const directory = mkdtempSync(join(tmpdir(), "roomform-reconstruction-jobs-"));
beforeAll(() => {
  process.env.DATA_DIR = directory;
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
async function fixture(owner: string) {
  const id = crypto.randomUUID();
  const photoIds = [crypto.randomUUID(), crypto.randomUUID()];
  const room = {
    id,
    name: "Room",
    type: "Living",
    notes: "Keep my floor",
    style: "Japandi",
    assets: photoIds.map((id) => ({ id, name: id, key: `${id}.jpeg`, kind: "room" as const })),
    designs: [],
    createdAt: new Date().toISOString(),
  };
  for (const asset of room.assets) await save(asset.key, new Uint8Array([1]), "image/jpeg");
  await saveRooms(owner, [room]);
  const scene: ReconstructedScene = {
    version: 1,
    kind: "sparse",
    positions: [0, 0, 0],
    colors: [255, 0, 0],
    cameras: photoIds.map((assetId) => ({
      assetId,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      width: 800,
      height: 600,
      fx: 500,
      fy: 500,
      cx: 400,
      cy: 300,
    })),
  };
  return { room, scene };
}
it("builds without an AI key, saves results after POST, rejects concurrent builds, and preserves room edits", async () => {
  const owner = "reconstruction-success";
  const { room, scene } = await fixture(owner);
  let complete!: (value: { scene: ReconstructedScene; components: number }) => void;
  vi.mocked(runColmap).mockImplementationOnce(async ({ progress }) => {
    await progress("Matching photo angles");
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const started = await startReconstruction(owner, { roomId: room.id });
  expect(started.reconstruction?.status).toBe("running");
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  await expect(startReconstruction(owner, { roomId: room.id })).rejects.toMatchObject({
    status: 409,
  });
  await expect(reconstructionRoom("someone-else", room.id)).rejects.toMatchObject({ status: 404 });
  await mutateRooms(owner, (all) => {
    all[0].notes = "Edited during build";
  });
  complete({ scene, components: 1 });
  await vi.waitFor(async () =>
    expect((await rooms(owner))[0].reconstruction?.status).toBe("succeeded"),
  );
  const result = (await rooms(owner))[0];
  expect(result.notes).toBe("Edited during build");
  expect(result.designs).toEqual([]);
  expect(await load(result.reconstruction!.result!.key)).not.toBeNull();
  vi.mocked(runColmap).mockRejectedValueOnce(new Error("Need more overlap"));
  await startReconstruction(owner, { roomId: room.id });
  await vi.waitFor(async () =>
    expect((await rooms(owner))[0].reconstruction?.status).toBe("failed"),
  );
  expect((await rooms(owner))[0].reconstruction?.result).toEqual(result.reconstruction?.result);
  expect(await load(result.reconstruction!.result!.key)).not.toBeNull();
});
it("cancels only the owner's build and recovers interrupted saved jobs", async () => {
  const owner = "reconstruction-cancel";
  const { room } = await fixture(owner);
  vi.mocked(runColmap).mockImplementationOnce(
    ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  const started = await startReconstruction(owner, { roomId: room.id });
  cancelRoomReconstruction("other", room.id, started.reconstruction!.id);
  expect((await rooms(owner))[0].reconstruction?.status).toBe("running");
  cancelRoomReconstruction(owner, room.id, started.reconstruction!.id);
  await vi.waitFor(async () =>
    expect((await rooms(owner))[0].reconstruction?.status).toBe("cancelled"),
  );
  await mutateRooms(owner, (all) => {
    all[0].reconstruction = { ...started.reconstruction!, id: crypto.randomUUID() };
  });
  expect((await reconstructionRoom(owner, room.id)).reconstruction?.error).toContain("restart");
});
it("runs AI only when requested, stores its provenance, and preserves the last result after a failed rebuild", async () => {
  const owner = "ai-layout-success";
  const { room } = await fixture(owner);
  await expect(
    startReconstruction(owner, { roomId: room.id, mode: "ai-layout" }),
  ).rejects.toMatchObject({ status: 503 });
  process.env.OPENAI_API_KEY = "test";
  const scene: ReconstructedScene = {
    version: 1,
    kind: "ai-layout",
    positions: [],
    colors: [],
    cameras: [],
    layout: exampleAiRoomLayout(),
    sourcePhotoIds: room.assets.map((a) => a.id),
    model: "gpt-6.1-sol",
  };
  vi.mocked(runAiRoomLayout).mockResolvedValueOnce({ scene, components: 1 });
  await startReconstruction(owner, { roomId: room.id, mode: "ai-layout" });
  await vi.waitFor(async () =>
    expect((await rooms(owner))[0].reconstruction?.status).toBe("succeeded"),
  );
  const result = (await rooms(owner))[0].reconstruction!.result!;
  expect(result).toMatchObject({
    kind: "ai-layout",
    fixtureCount: 1,
    registeredIds: [],
    pointCount: 0,
    model: "gpt-6.1-sol",
  });
  vi.mocked(runAiRoomLayout).mockRejectedValueOnce(new Error("Could not estimate room"));
  await startReconstruction(owner, { roomId: room.id, mode: "ai-layout" });
  await vi.waitFor(async () =>
    expect((await rooms(owner))[0].reconstruction?.status).toBe("failed"),
  );
  expect((await rooms(owner))[0].reconstruction?.result).toEqual(result);
  expect(await load(result.key)).not.toBeNull();
  delete process.env.OPENAI_API_KEY;
});
