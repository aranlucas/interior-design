import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleAiRoomLayout } from "./ai-room-layout.fixture";
import type { Room } from "./types";

const directory = mkdtempSync(join(tmpdir(), "roomform-layout-edits-"));
beforeAll(() => {
  process.env.DATA_DIR = directory;
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function fixture() {
  const s = await import("./storage.server");
  const owner = crypto.randomUUID(),
    roomId = crypto.randomUUID(),
    resultId = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    productId = crypto.randomUUID();
  const key = `${s.ownerPrefix(owner)}${roomId}/reconstruction.json`;
  const room: Room = {
    id: roomId,
    name: "Room",
    type: "Living room",
    notes: "",
    style: "",
    assets: [
      { id: photoId, key: "photo", name: "Photo", kind: "room" },
      { id: productId, key: "sofa", name: "Sofa", kind: "product", dimensions: "211 × 88 × 83 cm" },
    ],
    designs: [],
    createdAt: "",
    reconstruction: {
      id: resultId,
      status: "succeeded",
      stage: "Ready",
      photoIds: [photoId],
      createdAt: "",
      updatedAt: "",
      mode: "ai-layout",
      result: {
        id: resultId,
        key,
        kind: "ai-layout",
        photoIds: [photoId],
        sourcePhotoIds: [photoId],
        registeredIds: [],
        pointCount: 0,
        components: 1,
        fixtureCount: 1,
      },
    },
  };
  const scene = {
    version: 1,
    kind: "ai-layout",
    sourcePhotoIds: [photoId],
    positions: [],
    colors: [],
    cameras: [],
    layout: exampleAiRoomLayout(),
  };
  await s.save(key, JSON.stringify(scene), "application/json");
  await s.saveRooms(owner, [room]);
  const stored = async () => JSON.parse(Buffer.from((await s.load(key))!).toString());
  return { s, owner, room, resultId, productId, stored };
}

it("saves moved fixtures and placed room products, and later reads return the edited layout", async () => {
  const { owner, room, resultId, productId, stored } = await fixture();
  const { saveAiLayoutEdits } = await import("./reconstruction.server");
  const layout = exampleAiRoomLayout();
  layout.fixtures[0].x = 1.5;
  layout.products = [
    {
      assetId: productId,
      label: "Sofa",
      x: 2,
      z: 5,
      width: 2.11,
      depth: 0.88,
      height: 0.83,
      yawDegrees: 180,
    },
  ];
  const result = await saveAiLayoutEdits(owner, { roomId: room.id, resultId, layout });
  expect(result.scene.layout).toEqual(layout);
  expect((await stored()).layout).toEqual(layout);
  expect((await stored()).sourcePhotoIds).toEqual(room.reconstruction!.result!.sourcePhotoIds);
});

it("rejects foreign products, out-of-room geometry and replaced builds without changing the saved layout", async () => {
  const { owner, room, resultId, stored } = await fixture();
  const { saveAiLayoutEdits } = await import("./reconstruction.server");
  const before = await stored();
  const foreign = exampleAiRoomLayout();
  foreign.products = [
    {
      assetId: crypto.randomUUID(),
      label: "Chair",
      x: 2,
      z: 3,
      width: 0.5,
      depth: 0.5,
      height: 0.8,
      yawDegrees: 0,
    },
  ];
  await expect(
    saveAiLayoutEdits(owner, { roomId: room.id, resultId, layout: foreign }),
  ).rejects.toMatchObject({ status: 400 });
  const outside = exampleAiRoomLayout();
  outside.fixtures[0].x = 3.9;
  await expect(
    saveAiLayoutEdits(owner, { roomId: room.id, resultId, layout: outside }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    saveAiLayoutEdits(owner, {
      roomId: room.id,
      resultId: crypto.randomUUID(),
      layout: exampleAiRoomLayout(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    saveAiLayoutEdits("someone-else", { roomId: room.id, resultId, layout: exampleAiRoomLayout() }),
  ).rejects.toMatchObject({ status: 404 });
  expect(await stored()).toEqual(before);
});
