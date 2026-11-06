import { DatabaseSync } from "node:sqlite";
import type { PhotoMatches } from "./reconstruction";

/** Append user-selected keypoints, retaining automatic matches for the same pair. */
export function importPhotoMatches(databasePath: string, matches: PhotoMatches) {
  const db = new DatabaseSync(databasePath);
  try {
    const ids: number[] = [];
    const indices: number[][] = [];
    for (const side of ["a", "b"] as const) {
      const assetId = matches[`${side}Id`];
      const image = db
        .prepare(
          "SELECT images.image_id,images.name,cameras.width,cameras.height FROM images JOIN cameras ON images.camera_id=cameras.camera_id WHERE images.name LIKE ?",
        )
        .get(`${assetId}.%`);
      if (!image) throw new Error("A selected matching photo is missing.");
      const id = Number(image.image_id);
      ids.push(id);
      const row = db.prepare("SELECT rows,cols,data FROM keypoints WHERE image_id=?").get(id);
      if (!row) throw new Error("Photo features are missing.");
      const rows = Number(row.rows),
        cols = Number(row.cols);
      if (![2, 4, 6].includes(cols)) throw new Error("Unsupported photo feature format.");
      const original = Buffer.from(row.data as Uint8Array);
      const data = Buffer.alloc(original.length + matches.points.length * cols * 4);
      original.copy(data);
      matches.points.forEach((point, i) => {
        const offset = original.length + i * cols * 4;
        data.writeFloatLE(point[side][0] * Number(image.width), offset);
        data.writeFloatLE(point[side][1] * Number(image.height), offset + 4);
        if (cols >= 4) data.writeFloatLE(1, offset + 8);
        if (cols === 6) data.writeFloatLE(1, offset + 20);
      });
      db.prepare("UPDATE keypoints SET rows=?,data=? WHERE image_id=?").run(
        rows + matches.points.length,
        data,
        id,
      );
      const descriptor = db.prepare("SELECT cols,data FROM descriptors WHERE image_id=?").get(id);
      if (descriptor) {
        const old = Buffer.from(descriptor.data as Uint8Array);
        const next = Buffer.alloc(old.length + matches.points.length * Number(descriptor.cols));
        old.copy(next);
        db.prepare("UPDATE descriptors SET rows=?,data=? WHERE image_id=?").run(
          rows + matches.points.length,
          next,
          id,
        );
      }
      indices.push(matches.points.map((_, i) => rows + i));
    }
    const pairId = Math.min(...ids) * 2147483647 + Math.max(...ids);
    const previous = db.prepare("SELECT rows,data FROM matches WHERE pair_id=?").get(pairId);
    const pairs: [number, number][] = [];
    if (previous) {
      const data = Buffer.from(previous.data as Uint8Array);
      for (let i = 0; i < Number(previous.rows); i++) {
        const a = data.readUInt32LE(i * 8),
          b = data.readUInt32LE(i * 8 + 4);
        pairs.push(ids[0] < ids[1] ? [a, b] : [b, a]);
      }
    }
    pairs.push(...matches.points.map((_, i): [number, number] => [indices[0][i], indices[1][i]]));
    db.prepare("DELETE FROM two_view_geometries WHERE pair_id=?").run(pairId);
    db.prepare("DELETE FROM matches WHERE pair_id=?").run(pairId);
    const aName = String(db.prepare("SELECT name FROM images WHERE image_id=?").get(ids[0])!.name);
    const bName = String(db.prepare("SELECT name FROM images WHERE image_id=?").get(ids[1])!.name);
    return {
      text: `${aName} ${bName}\n${pairs.map(([a, b]) => `${a} ${b}`).join("\n")}\n\n`,
      imageIds: ids,
    };
  } finally {
    db.close();
  }
}
