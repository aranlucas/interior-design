import { createFileRoute } from "@tanstack/react-router";
import { requireUser, sameOrigin } from "../../lib/auth.server";
import { getJob, rooms } from "../../lib/storage.server";
import { startFinalRender, startGeneration } from "../../lib/generation.server";
import { designInput, finalRenderInput, uuid } from "../../lib/validation";
import { handle } from "../../lib/http.server";
export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(async () => {
          sameOrigin(request);
          const user = await requireUser(request);
          const body = await request.json();
          if (body && typeof body === "object" && "final" in body)
            return Response.json(await startFinalRender(user.sub, finalRenderInput.parse(body)), {
              status: 202,
            });
          const input = designInput.parse(body);
          return Response.json(await startGeneration(user.sub, input), { status: 202 });
        }),
      GET: ({ request }) =>
        handle(async () => {
          const user = await requireUser(request);
          const value = new URL(request.url).searchParams.get("jobId");
          const job = getJob(user.sub, value === null ? undefined : uuid.parse(value));
          if (value && !job) return new Response("Job not found", { status: 404 });
          const room =
            job?.status === "succeeded"
              ? (await rooms(user.sub)).find((r) => r.id === job.roomId)
              : undefined;
          return Response.json(
            { job: job || null, room },
            { headers: { "Cache-Control": "no-store" } },
          );
        }),
    },
  },
});
