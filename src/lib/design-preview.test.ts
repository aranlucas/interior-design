import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "roomform-previews-"));
beforeAll(() => {
  process.env.DATA_DIR = directory;
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

/** A baseline JPEG SOF0 header of the given size; enough for dimension validation. */
const jpeg = (width: number, height: number, fill = 0) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    8,
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    fill,
    0xff,
    0xd9,
  ]);

it("stores one small preview per design, rejects full-size images, and deletes it with the design", async () => {
  const s = await import("./storage.server");
  const { saveDesignPreview, deleteDesign } = await import("./room-actions.server");
  const owner = "previews",
    roomId = crypto.randomUUID(),
    designId = crypto.randomUUID();
  const key = `${s.ownerPrefix(owner)}${roomId}/${designId}.png`;
  await s.save(key, new Uint8Array([1]), "image/png");
  await s.saveRooms(owner, [
    {
      id: roomId,
      name: "Room",
      type: "Living room",
      notes: "",
      style: "",
      assets: [],
      designs: [{ id: designId, key, prompt: "", baseId: "", createdAt: "" }],
      createdAt: "",
    },
  ]);
  // A 3840-wide image is the full design, not a preview.
  await expect(saveDesignPreview(owner, roomId, designId, jpeg(3840, 2160))).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    saveDesignPreview(owner, roomId, designId, new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    saveDesignPreview("someone-else", roomId, designId, jpeg(640, 360)),
  ).rejects.toMatchObject({ status: 404 });

  const first = await saveDesignPreview(owner, roomId, designId, jpeg(640, 360, 1));
  const previewKey = first.designs[0].previewKey!;
  expect(previewKey.startsWith(`${s.ownerPrefix(owner)}${roomId}/`)).toBe(true);
  expect(await s.load(previewKey)).toEqual(jpeg(640, 360, 1));
  // A second tab racing the backfill must not replace the stored preview.
  await saveDesignPreview(owner, roomId, designId, jpeg(640, 360, 2));
  expect(await s.load(previewKey)).toEqual(jpeg(640, 360, 1));

  await deleteDesign(owner, roomId, designId);
  expect(await s.load(previewKey)).toBeNull();
  expect(await s.load(key)).toBeNull();
});
