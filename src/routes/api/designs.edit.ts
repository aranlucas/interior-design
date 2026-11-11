import { createFileRoute } from "@tanstack/react-router";
import { requireUser, sameOrigin } from "../../lib/auth.server";
import { startEditGeneration } from "../../lib/generation.server";
import { editInput } from "../../lib/validation";
import { handle } from "../../lib/http.server";
const MAX_MASK = 4_000_000;
export const Route = createFileRoute("/api/designs/edit")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(async () => {
          sameOrigin(request);
          const user = await requireUser(request);
          const form = await request.formData();
          const mask = form.get("mask");
          if (!(mask instanceof File) || !mask.size || mask.size > MAX_MASK)
            throw new Response("Attach a non-empty PNG mask (under 4 MB).", { status: 400 });
          const input = editInput.parse({
            roomId: form.get("roomId"),
            designId: form.get("designId"),
            prompt: form.get("prompt"),
            assetIds: form.getAll("assetIds"),
          });
          return Response.json(
            await startEditGeneration(user.sub, {
              ...input,
              mask: new Uint8Array(await mask.arrayBuffer()),
            }),
            { status: 202 },
          );
        }),
    },
  },
});
