import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

export default {
  workers: 1,
  retries: 0,
  targets: [
    {
      engine: web(),
      app: {
        url: "http://localhost:3000",
        command: {
          executable: "npm",
          args: ["run", "dev:local"],
          env: { ROOMFORM_LOCAL: "true", APP_URL: "http://localhost:3000", DATA_DIR: ".data/e2e" },
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
