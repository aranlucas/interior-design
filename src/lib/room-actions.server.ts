import { mutateRooms, ownerPrefix, remove, writeObject } from "./storage.server";
import { roomUpdate } from "./validation";
import { roomModel } from "./room-model";
import { jpegDimensions } from "./image-size";
import type { Asset } from "./types";

export async function attachAsset(
  owner: string,
  roomId: string,
  metadata: Omit<Asset, "id" | "key">,
  bytes: Uint8Array,
  contentType: string,
) {
  const id = crypto.randomUUID();
  const key = `${ownerPrefix(owner)}${roomId}/${id}.${contentType.split("/")[1]}`;
  return mutateRooms(owner, (all) => {
    const room = all.find((r) => r.id === roomId);
    if (!room) throw new Response("Room not found", { status: 404 });
    if (room.assets.length >= 16) throw new Error("A room can hold up to 16 reference photos.");
    writeObject(key, bytes, contentType);
    room.assets.push({ ...metadata, id, key });
    return room;
  });
}

export async function deleteAsset(owner: string, roomId: string, assetId: string) {
  return mutateRooms(owner, (all) => {
    const room = all.find((r) => r.id === roomId);
    if (!room) throw new Response("Room not found", { status: 404 });
    const asset = room.assets.find((a) => a.id === assetId);
    if (asset?.key.startsWith(`${ownerPrefix(owner)}${roomId}/`)) remove(asset.key);
    room.assets = room.assets.filter((a) => a.id !== assetId);
    if (room.model) room.model = roomModel(room.model, room.assets);
    return room;
  });
}

export async function updateRoom(owner: string, value: unknown) {
  const input = roomUpdate.parse(value);
  return mutateRooms(owner, (all) => {
    const room = all.find((r) => r.id === input.roomId);
    if (!room) throw new Response("Room not found", { status: 404 });
    if ("designId" in input) {
      const design = room.designs.find((d) => d.id === input.designId);
      if (!design) throw new Response("Design not found", { status: 404 });
      design.starred = input.starred;
    } else if ("model" in input) {
      for (const id of Object.values(input.model.walls)) {
        if (id && !room.assets.some((a) => a.id === id && a.kind === "room"))
          throw new Response("Choose a room photo from this room for each wall.", { status: 400 });
      }
      room.model = input.model;
    } else if ("assetId" in input) {
      const asset = room.assets.find((a) => a.id === input.assetId && a.kind !== "room");
      if (!asset) throw new Response("Reference not found", { status: 404 });
      asset.dimensions = input.dimensions;
    } else if ("name" in input) room.name = input.name;
    else {
      room.notes = input.notes;
      room.style = input.style;
      if (input.imageSettings) room.imageSettings = input.imageSettings;
    }
    return room;
  });
}
export async function deleteDesign(owner: string, roomId: string, designId: string) {
  return mutateRooms(owner, (all) => {
    const room = all.find((r) => r.id === roomId);
    const design = room?.designs.find((d) => d.id === designId);
    if (!room || !design) throw new Response("Design not found", { status: 404 });
    if (design.key.startsWith(ownerPrefix(owner))) remove(design.key);
    // Variations from one run share a prompt; keep it while a sibling still uses it.
    const sharedPrompt = room.designs.some(
      (d) => d.id !== designId && d.promptKey === design.promptKey,
    );
    for (const key of [
      sharedPrompt ? undefined : design.promptKey,
      design.previewKey,
      design.guide?.key,
      design.guide?.layoutKey,
    ]) {
      if (key?.startsWith(`${ownerPrefix(owner)}${roomId}/`)) remove(key);
    }
    room.designs = room.designs.filter((d) => d.id !== designId);
    return room;
  });
}

export const PREVIEW_EDGE = 640;
const PREVIEW_BYTES = 400_000;

/**
 * Attach a small browser-made JPEG preview to a design, so filmstrips stop downloading the
 * full-resolution PNG. Idempotent: a design keeps its first valid preview.
 */
export async function saveDesignPreview(
  owner: string,
  roomId: string,
  designId: string,
  bytes: Uint8Array,
) {
  const dims = jpegDimensions(bytes);
  if (!dims || bytes.byteLength > PREVIEW_BYTES || Math.max(dims.width, dims.height) > PREVIEW_EDGE)
    throw new Response(`Upload a JPEG preview up to ${PREVIEW_EDGE} px.`, { status: 400 });
  const key = `${ownerPrefix(owner)}${roomId}/${designId}-preview.jpeg`;
  return mutateRooms(owner, (all) => {
    const room = all.find((r) => r.id === roomId);
    const design = room?.designs.find((d) => d.id === designId);
    if (!room || !design) throw new Response("Design not found", { status: 404 });
    if (!design.previewKey) {
      writeObject(key, bytes, "image/jpeg");
      design.previewKey = key;
    }
    return room;
  });
}
