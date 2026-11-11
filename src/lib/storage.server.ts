import { ENV } from "varlock/env";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { GenerationJob, Room } from "./types";
export const ownerPrefix = (sub: string) =>
  `users/${createHash("sha256").update(sub).digest("hex")}/`;
let database: DatabaseSync | undefined;
function db() {
  if (database) return database;
  const directory = ENV.DATA_DIR || ".data";
  mkdirSync(directory, { recursive: true });
  database = new DatabaseSync(resolve(directory, "roomform.sqlite"));
  database.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, data BLOB NOT NULL, content_type TEXT NOT NULL); CREATE TABLE IF NOT EXISTS generation_leases (owner TEXT PRIMARY KEY, expires INTEGER NOT NULL);",
  );
  database.exec(
    "CREATE TABLE IF NOT EXISTS generation_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, roomId TEXT NOT NULL, status TEXT NOT NULL, error TEXT, designId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL); CREATE INDEX IF NOT EXISTS jobs_owner_created ON generation_jobs(owner, createdAt);",
  );
  // This app runs one replica. A new connection belongs to a new server process.
  database
    .prepare(
      "UPDATE generation_jobs SET status='failed', error=?, updatedAt=? WHERE status='running'",
    )
    .run("Generation interrupted by a server restart. Please try again.", new Date().toISOString());
  database.exec("DELETE FROM generation_leases");
  return database;
}
export async function save(key: string, data: Uint8Array | string, contentType: string) {
  writeObject(key, data, contentType);
}
export function writeObject(key: string, data: Uint8Array | string, contentType: string) {
  db()
    .prepare(
      "INSERT INTO objects (key,data,content_type) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,content_type=excluded.content_type",
    )
    // SQLite copies the bound bytes synchronously; avoid another full image copy here.
    .run(key, typeof data === "string" ? Buffer.from(data) : data, contentType);
}
export async function load(key: string): Promise<Uint8Array | null> {
  const row = db().prepare("SELECT data FROM objects WHERE key=?").get(key);
  return (row?.data as Uint8Array) || null;
}
// Read lengths without materializing SQLite blobs into the Node heap.
export function assertImageBudget(keys: string[], extraBytes = 0) {
  let total = extraBytes;
  const size = db().prepare("SELECT length(data) AS bytes FROM objects WHERE key=?");
  for (const key of keys) {
    const row = size.get(key);
    if (!row) throw new Error("A reference image is missing. Please upload it again.");
    total += Number(row.bytes);
  }
  if (total > 32_000_000)
    throw new Error(
      "These images exceed the 32 MB processing budget. Use fewer or smaller references.",
    );
}
export function remove(key: string) {
  db().prepare("DELETE FROM objects WHERE key=?").run(key);
}
export async function rooms(sub: string): Promise<Room[]> {
  return readRooms(sub);
}
function readRooms(sub: string): Room[] {
  const row = db()
    .prepare("SELECT data FROM objects WHERE key=?")
    .get(`${ownerPrefix(sub)}rooms.json`);
  return row ? JSON.parse(Buffer.from(row.data as Uint8Array).toString()) : [];
}
export async function saveRooms(sub: string, data: Room[]) {
  await save(`${ownerPrefix(sub)}rooms.json`, JSON.stringify(data), "application/json");
}
export async function mutateRooms<T>(sub: string, mutate: (all: Room[]) => T): Promise<T> {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const all = readRooms(sub);
    const result = mutate(all);
    connection
      .prepare(
        "INSERT INTO objects (key,data,content_type) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(`${ownerPrefix(sub)}rooms.json`, Buffer.from(JSON.stringify(all)), "application/json");
    connection.exec("COMMIT");
    return result;
  } catch (e) {
    connection.exec("ROLLBACK");
    throw e;
  }
}
function hasRunningGeneration(sub: string) {
  return !!db()
    .prepare("SELECT 1 FROM generation_jobs WHERE owner=? AND status='running' LIMIT 1")
    .get(sub);
}
export function claimGeneration(sub: string, ttl = 300_000) {
  // A provider call can outlive its lease (including the layout pre-pass).
  // Only settlement or startup recovery may release an admitted running job.
  if (hasRunningGeneration(sub)) return false;
  const now = Date.now();
  return (
    db()
      .prepare(
        "INSERT INTO generation_leases (owner,expires) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET expires=excluded.expires WHERE generation_leases.expires < ?",
      )
      .run(sub, now + ttl, now).changes > 0
  );
}
export function releaseGeneration(sub: string) {
  db().prepare("DELETE FROM generation_leases WHERE owner=?").run(sub);
}
export async function deleteRoom(sub: string, roomId: string) {
  return mutateRooms(sub, (all) => {
    const index = all.findIndex((room) => room.id === roomId);
    if (index < 0) return false;
    const lease = db().prepare("SELECT expires FROM generation_leases WHERE owner=?").get(sub);
    if (hasRunningGeneration(sub) || (lease && Number(lease.expires) > Date.now()))
      throw new Response("Wait for your design to finish before deleting a room.", { status: 409 });
    const prefix = `${ownerPrefix(sub)}${roomId}/`;
    db().prepare("DELETE FROM objects WHERE substr(key,1,?)=?").run(prefix.length, prefix);
    all.splice(index, 1);
    return true;
  });
}

export function createJob(owner: string, roomId: string): GenerationJob {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO generation_jobs (id,owner,roomId,status,createdAt,updatedAt) VALUES (?,?,?,'running',?,?)",
    )
    .run(id, owner, roomId, now, now);
  return getJob(owner, id)!;
}
export function finishJob(
  owner: string,
  id: string,
  result: { designId: string } | { error: string },
) {
  db()
    .prepare(
      "UPDATE generation_jobs SET status=?,error=?,designId=?,updatedAt=? WHERE owner=? AND id=? AND status='running'",
    )
    .run(
      "error" in result ? "failed" : "succeeded",
      "error" in result ? result.error : null,
      "designId" in result ? result.designId : null,
      new Date().toISOString(),
      owner,
      id,
    );
}
export function getJob(owner: string, id?: string): GenerationJob | undefined {
  const connection = db();
  const row = id
    ? connection.prepare("SELECT * FROM generation_jobs WHERE owner=? AND id=?").get(owner, id)
    : connection
        .prepare(
          "SELECT * FROM generation_jobs WHERE owner=? ORDER BY createdAt DESC, rowid DESC LIMIT 1",
        )
        .get(owner);
  return row as GenerationJob | undefined;
}
