import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimGeneration, createJob, deleteRoom, rooms, saveRooms } from "./storage.server";
import { settleGeneration } from "./generation.server";

const directory = mkdtempSync(join(tmpdir(), "roomform-admission-"));
beforeAll(() => vi.stubEnv("DATA_DIR", directory));
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

// Slow layout + image calls can exceed the lease. Paid work must remain exclusive.
it("rejects overlapping work after lease expiry until the running job settles", async () => {
  const owner = "slow-owner";
  expect(claimGeneration(owner)).toBe(true);
  const job = createJob(owner, crypto.randomUUID());
  let complete!: (id: string) => void;
  const pending = settleGeneration(
    owner,
    job.id,
    () => new Promise((resolve) => (complete = resolve)),
  );
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 360_000);
  expect(claimGeneration(owner)).toBe(false);
  expect(claimGeneration("other-owner")).toBe(true);
  complete("design");
  await pending;
  expect(claimGeneration(owner)).toBe(true);
});

it("keeps the room and media while paid work is running beyond lease expiry", async () => {
  const owner = "slow-delete-owner";
  const roomId = crypto.randomUUID();
  await saveRooms(owner, [
    {
      id: roomId,
      name: "Keep",
      type: "Bedroom",
      notes: "",
      style: "",
      assets: [],
      designs: [],
      createdAt: "",
    },
  ]);
  expect(claimGeneration(owner)).toBe(true);
  const job = createJob(owner, roomId);
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 360_000);
  await expect(deleteRoom(owner, roomId)).rejects.toMatchObject({ status: 409 });
  expect((await rooms(owner))[0].name).toBe("Keep");
  await settleGeneration(owner, job.id, async () => {
    throw new Error("Provider failed");
  });
  expect(await deleteRoom(owner, roomId)).toBe(true);
});
