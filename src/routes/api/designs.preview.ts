import { createFileRoute } from "@tanstack/react-router";
import { requireUser, sameOrigin } from "../../lib/auth.server";
import { saveDesignPreview } from "../../lib/room-actions.server";
import { uuid } from "../../lib/validation";
import { handle } from "../../lib/http.server";
export const Route = createFileRoute("/api/designs/preview")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(async () => {
          sameOrigin(request);
          const user = await requireUser(request);
          const form = await request.formData();
          const file = form.get("preview");
          if (!(file instanceof File) || !file.size || file.size > 400_000)
            throw new Response("Attach a JPEG preview under 400 KB.", { status: 400 });
          return Response.json(
            await saveDesignPreview(
              user.sub,
              uuid.parse(form.get("roomId")),
              uuid.parse(form.get("designId")),
              new Uint8Array(await file.arrayBuffer()),
            ),
          );
        }),
    },
  },
});
