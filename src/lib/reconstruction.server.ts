import { selectAiRoomPhotos } from "./ai-room-layout";
import { acquireHeavyWork } from "./heavy-work.server";
import { ENV } from "varlock/env";
import { reconstructionInput } from "./reconstruction";
import { reconstructionEngineAvailable, runColmap } from "./colmap-runner.server";
import { runAiRoomLayout } from "./ai-room-layout.server";
import {
  assertImageBudget,
  load,
  mutateRooms,
  ownerPrefix,
  rooms,
  save,
  remove,
} from "./storage.server";
import type { ReconstructionJob, Room } from "./types";

type Running = { owner: string; roomId: string; controller: AbortController };
const runtime = globalThis as typeof globalThis & { roomformReconstruction?: Map<string, Running> };
const running = (runtime.roomformReconstruction ??= new Map());

export async function reconstructionRoom(owner: string, roomId: string) {
  let room = (await rooms(owner)).find((r) => r.id === roomId);
  if (!room) throw new Response("Room not found", { status: 404 });
  if (room.reconstruction?.status === "running" && !running.has(room.reconstruction.id)) {
    const id = room.reconstruction.id;
    room = await mutateRooms(owner, (all) => {
      const target = all.find((r) => r.id === roomId)!;
      if (target.reconstruction?.id === id) {
        target.reconstruction.status = "failed";
        target.reconstruction.error =
          "The build was interrupted by a server restart. Build the room again to retry.";
        target.reconstruction.updatedAt = new Date().toISOString();
      }
      return target;
    });
  }
  return room;
}

export async function startReconstruction(owner: string, value: unknown) {
  const input = reconstructionInput.parse(value);
  const room = await reconstructionRoom(owner, input.roomId);
  const photos = room.assets.filter((a) => a.kind === "room");
  if (photos.length < (input.mode === "ai-layout" ? 1 : 2))
    throw new Error(
      input.mode === "ai-layout"
        ? "Add a room photo before building an AI layout."
        : "Add at least two overlapping photos of the same room.",
    );
  if (input.mode === "ai-layout" && input.matches)
    throw new Error(
      "Guided photo matches apply to classical reconstruction. Choose Photo matching to use them.",
    );
  if (
    input.matches &&
    ![input.matches.aId, input.matches.bId].every((id) => photos.some((p) => p.id === id))
  )
    throw new Response("Choose matching photos from this room.", { status: 400 });
  if (running.size)
    throw new Response("A 3D room is already building. Wait for it to finish or cancel it first.", {
      status: 409,
    });
  if (input.mode === "ai-layout" && !ENV.OPENAI_API_KEY)
    throw new Response("AI-assisted room builds aren’t configured on this server.", {
      status: 503,
    });
  if (input.mode === "classical" && !(await reconstructionEngineAvailable()))
    throw new Response(
      "Automatic room builds aren’t available on this server. You can still use the manual layout.",
      { status: 503 },
    );
  // Recheck after the asynchronous engine probe to prevent simultaneous starts.
  if (running.size)
    throw new Response("A 3D room is already building. Please wait.", { status: 409 });
  const id = crypto.randomUUID(),
    controller = new AbortController();
  const releaseWork = acquireHeavyWork();
  running.set(id, { owner, roomId: room.id, controller });
  const now = new Date().toISOString();
  const job: ReconstructionJob = {
    id,
    status: "running",
    mode: input.mode,
    stage: input.mode === "ai-layout" ? "Preparing room photos for AI" : "Preparing photos",
    photoIds: photos.map((p) => p.id),
    createdAt: now,
    updatedAt: now,
    result: room.reconstruction?.result,
  };
  try {
    const updated = await mutateRooms(owner, (all) => {
      const target = all.find((r) => r.id === room.id);
      if (!target) throw new Response("Room not found", { status: 404 });
      target.reconstruction = job;
      return target;
    });
    void settle(owner, updated, controller, input.matches, releaseWork).catch((error) =>
      console.error("Could not settle room reconstruction", error),
    );
    return updated;
  } catch (error) {
    running.delete(id);
    releaseWork();
    throw error;
  }
}

async function settle(
  owner: string,
  room: Room,
  controller: AbortController,
  matches: Parameters<typeof runColmap>[0]["matches"],
  releaseWork: () => void,
) {
  const job = room.reconstruction!;
  const deadline = AbortSignal.timeout(12 * 60_000);
  let resultKey: string | undefined;
  const update = (edit: (job: ReconstructionJob, target: Room) => void) =>
    mutateRooms(owner, (all) => {
      const target = all.find((r) => r.id === room.id);
      if (!target || target.reconstruction?.id !== job.id)
        throw new Error("The room was removed or this build was replaced.");
      edit(target.reconstruction, target);
      target.reconstruction.updatedAt = new Date().toISOString();
      return target;
    });
  try {
    const photos = room.assets.filter((a) => a.kind === "room");
    assertImageBudget(
      (job.mode === "ai-layout" ? selectAiRoomPhotos(photos) : photos).map((a) => a.key),
    );
    const options = {
      measurements: room.measurements,
      photos: room.assets.filter((a) => a.kind === "room"),
      matches,
      loadPhoto: load,
      signal: AbortSignal.any([controller.signal, deadline]),
      progress: async (stage: string) => {
        await update((value) => {
          value.stage = stage;
        });
      },
    };
    const { scene, components } =
      job.mode === "ai-layout" ? await runAiRoomLayout(options) : await runColmap(options);
    controller.signal.throwIfAborted();
    resultKey = `${ownerPrefix(owner)}${room.id}/reconstruction-${job.id}.json`;
    await save(resultKey, JSON.stringify(scene), "application/json");
    await update((value, target) => {
      if (!job.photoIds.every((id) => target.assets.some((a) => a.id === id && a.kind === "room")))
        throw new Error(
          "Room photos changed during the build. Build again using the current photos.",
        );
      value.status = "succeeded";
      value.stage = scene.kind === "ai-layout" ? "AI-estimated layout ready" : "3D preview ready";
      value.result = {
        id: job.id,
        key: resultKey!,
        photoIds: job.photoIds,
        registeredIds: scene.cameras.map((c) => c.assetId),
        pointCount: scene.positions.length / 3,
        components,
        kind: scene.kind,
        sourcePhotoIds: scene.sourcePhotoIds,
        model: scene.model,
        fixtureCount: scene.layout?.fixtures.length,
      };
    });
    if (job.result && job.result.key !== resultKey) remove(job.result.key);
  } catch (error) {
    if (resultKey) remove(resultKey);
    try {
      await update((value) => {
        value.status = controller.signal.aborted ? "cancelled" : "failed";
        value.stage = controller.signal.aborted ? "Build cancelled" : "Build could not finish";
        value.error = controller.signal.aborted
          ? undefined
          : deadline.aborted
            ? "The 3D build reached its time limit. Try a smaller set of overlapping photos."
            : error instanceof Error && !("cmd" in error)
              ? error.message
              : job.mode === "ai-layout"
                ? "The AI layout could not be completed. Try again with clearer photos of the same room."
                : "The photos could not be reconstructed. Add more overlapping angles or help match photo details, then try again.";
      });
    } catch {
      /* A removed room must not be recreated by a late worker. */
    }
  } finally {
    running.delete(job.id);
    releaseWork();
  }
}

export function cancelRoomReconstruction(owner: string, roomId: string, jobId?: string) {
  for (const [id, build] of running) {
    if (build.owner === owner && build.roomId === roomId && (!jobId || id === jobId))
      build.controller.abort();
  }
}
