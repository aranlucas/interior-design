import { createFileRoute } from "@tanstack/react-router";
import { requireUser, sameOrigin } from "../../lib/auth.server";
import { rooms } from "../../lib/storage.server";
import { attachAsset } from "../../lib/room-actions.server";
import { importProduct } from "../../lib/product-import.server";
import { handle } from "../../lib/http.server";
import { z } from "zod";
export const Route = createFileRoute("/api/import")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(async () => {
          sameOrigin(request);
          const u = await requireUser(request);
          const input = z
            .object({
              roomId: z.uuid(),
              url: z.url(),
              name: z.string().max(120),
              kind: z.enum(["product", "inspiration"]).default("product"),
              dimensions: z.string().trim().max(200).default(""),
            })
            .parse(await request.json());
          const room = (await rooms(u.sub)).find((r) => r.id === input.roomId);
          if (!room) throw new Response("Room not found", { status: 404 });
          if (room.assets.length >= 16) throw new Error("A room can hold up to 16 photos.");
          const imported = await importProduct(input.url);
          return Response.json(
            await attachAsset(
              u.sub,
              room.id,
              {
                name: input.name || imported.title,
                kind: input.kind,
                url: input.url,
                notes: imported.notes,
                dimensions: input.dimensions || imported.dimensions,
                availableSizes: imported.availableSizes,
              },
              imported.bytes,
              imported.type,
            ),
          );
        }),
    },
  },
});
