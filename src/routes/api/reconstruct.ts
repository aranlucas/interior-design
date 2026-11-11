import { ENV } from "varlock/env";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser, sameOrigin } from "../../lib/auth.server";
import { handle } from "../../lib/http.server";
import { load } from "../../lib/storage.server";
import { reconstructionEngineAvailable } from "../../lib/colmap-runner.server";
import {
  cancelRoomReconstruction,
  reconstructionRoom,
  saveAiLayoutEdits,
  startReconstruction,
} from "../../lib/reconstruction.server";

export const Route = createFileRoute("/api/reconstruct")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(async () => {
          const user = await requireUser(request);
          const params = new URL(request.url).searchParams;
          const room = await reconstructionRoom(user.sub, z.uuid().parse(params.get("roomId")));
          const resultId = params.get("resultId");
          if (resultId) {
            z.uuid().parse(resultId);
            if (room.reconstruction?.result?.id !== resultId)
              throw new Response("Reconstruction not found", { status: 404 });
            const data = await load(room.reconstruction.result.key);
            if (!data) throw new Response("Reconstruction not found", { status: 404 });
            return new Response(Buffer.from(data), {
              headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
            });
          }
          return Response.json(
            {
              room,
              available: await reconstructionEngineAvailable(),
              aiAvailable: !!ENV.OPENAI_API_KEY,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }),
      POST: ({ request }) =>
        handle(async () => {
          sameOrigin(request);
          const user = await requireUser(request);
          return Response.json(
            { room: await startReconstruction(user.sub, await request.json()) },
            { status: 202 },
          );
        }),
      PATCH: ({ request }) =>
        handle(async () => {
          sameOrigin(request);
          const user = await requireUser(request);
          return Response.json(await saveAiLayoutEdits(user.sub, await request.json()));
        }),
      DELETE: ({ request }) =>
        handle(async () => {
          sameOrigin(request);
          const user = await requireUser(request);
          const input = z.object({ roomId: z.uuid(), jobId: z.uuid() }).parse(await request.json());
          const room = await reconstructionRoom(user.sub, input.roomId);
          if (room.reconstruction?.id !== input.jobId || room.reconstruction.status !== "running")
            throw new Response("That build is no longer running. Refresh to see its result.", {
              status: 409,
            });
          cancelRoomReconstruction(user.sub, input.roomId, input.jobId);
          return Response.json({ cancelled: true });
        }),
    },
  },
});
