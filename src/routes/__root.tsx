import icon from "../../assets/icon.svg?url";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import css from "../styles.css?url";
import archivo from "@fontsource-variable/archivo/wdth.css?url";
import type { QueryClient } from "@tanstack/react-query";
import type { StudioData } from "../lib/studio-data";
export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  studioData: StudioData;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Roomform" },
      { name: "color-scheme", content: "light dark" },
      { name: "theme-color", content: "#e6eae5", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#232a2a", media: "(prefers-color-scheme: dark)" },
    ],
    links: [
      { rel: "stylesheet", href: archivo },
      { rel: "stylesheet", href: css },
      { rel: "icon", type: "image/svg+xml", href: icon },
    ],
  }),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
