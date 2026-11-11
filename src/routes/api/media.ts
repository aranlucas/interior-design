import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../lib/auth.server";
import { load, ownerPrefix } from "../../lib/storage.server";
import { handle } from "../../lib/http.server";
export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(async () => {
          const u = await requireUser(request);
          const key = new URL(request.url).searchParams.get("key") || "";
          if (
            !key.startsWith(ownerPrefix(u.sub)) ||
            key.includes("..") ||
            !/(\.(png|jpeg|webp)|-layout\.json)$/.test(key)
          )
            return new Response("Not found", { status: 404 });
          const bytes = await load(key);
          if (!bytes) return new Response("Not found", { status: 404 });
          return new Response(bytes as Uint8Array<ArrayBuffer>, {
            headers: {
              "Content-Type": key.endsWith("-layout.json")
                ? "application/json"
                : `image/${key.split(".").pop()}`,
              "Cache-Control": "private, max-age=31536000, immutable",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }),
    },
  },
});
