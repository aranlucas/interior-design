import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { attachAsset, deleteAsset } from "./room-actions.server";
import { load, ownerPrefix, rooms, save, saveRooms } from "./storage.server";
import type { Room } from "./types";

const directory = mkdtempSync(join(tmpdir(), "roomform-assets-"));
beforeAll(() => vi.stubEnv("DATA_DIR", directory));
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
const owner = "asset-owner";
const metadata = { name: "Photo", kind: "room" as const };
async function createRoom() {
  const room: Room = {
    id: crypto.randomUUID(),
    name: "Room",
    type: "Bedroom",
    notes: "",
    style: "",
    assets: [],
    designs: [],
    createdAt: new Date().toISOString(),
  };
  await saveRooms(owner, [room]);
  return room;
}

it("attaches the exact bytes to the selected room and enforces ownership", async () => {
  const room = await createRoom();
  await expect(
    attachAsset("other", room.id, metadata, new Uint8Array([1]), "image/png"),
  ).rejects.toMatchObject({ status: 404 });
  const updated = await attachAsset(
    owner,
    room.id,
    metadata,
    new Uint8Array([1, 128, 255]),
    "image/png",
  );
  expect(updated.assets).toHaveLength(1);
  expect(updated.assets[0]).toMatchObject(metadata);
  expect(updated.assets[0].key).toMatch(new RegExp(`^${ownerPrefix(owner)}${room.id}/`));
  expect(await load(updated.assets[0].key)).toEqual(new Uint8Array([1, 128, 255]));
  expect((await rooms(owner))[0].assets).toEqual(updated.assets);
});

it("rejects attachment to a full room without changing media or room records", async () => {
  const room = await createRoom();
  room.assets = Array.from({ length: 16 }, (_, i) => ({
    ...metadata,
    id: String(i),
    key: `keep-${i}`,
  }));
  await saveRooms(owner, [room]);
  await expect(
    attachAsset(owner, room.id, metadata, new Uint8Array([1]), "image/png"),
  ).rejects.toThrow("16");
  expect((await rooms(owner))[0]).toEqual(room);
});

it("rolls back both blob and asset when the room record cannot be committed", async () => {
  const room = await createRoom();
  const connection = new DatabaseSync(join(directory, "roomform.sqlite"));
  connection.exec(`CREATE TRIGGER reject_room_update BEFORE UPDATE ON objects
    WHEN NEW.key LIKE '%/rooms.json' BEGIN SELECT RAISE(ABORT, 'room write failed'); END;`);
  try {
    await expect(
      attachAsset(owner, room.id, metadata, new Uint8Array([1]), "image/png"),
    ).rejects.toThrow("room write failed");
    expect((await rooms(owner))[0].assets).toEqual([]);
    const prefix = `${ownerPrefix(owner)}${room.id}/`;
    expect(
      connection
        .prepare("SELECT count(*) AS count FROM objects WHERE substr(key,1,?)=?")
        .get(prefix.length, prefix)?.count,
    ).toBe(0);
  } finally {
    connection.exec("DROP TRIGGER reject_room_update");
    connection.close();
  }
});

it("deletes a photo and its wall assignment while preserving unrelated media", async () => {
  const room = await createRoom();
  const attached = await attachAsset(owner, room.id, metadata, new Uint8Array([1]), "image/png");
  const asset = attached.assets[0];
  attached.model = { width: 4, depth: 5, height: 2.7, walls: { back: asset.id } };
  await saveRooms(owner, [attached]);
  const otherKey = `${ownerPrefix("other")}${room.id}/keep.png`;
  await save(otherKey, new Uint8Array([2]), "image/png");
  const deleted = await deleteAsset(owner, room.id, asset.id);
  expect(deleted.assets).toEqual([]);
  expect(deleted.model?.walls).toEqual({});
  expect(await load(asset.key)).toBeNull();
  expect(await load(otherKey)).toEqual(new Uint8Array([2]));
});
