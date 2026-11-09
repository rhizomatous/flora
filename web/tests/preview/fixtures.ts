// oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks are not React hooks.
import { fileURLToPath } from "node:url";

import { test as base } from "@playwright/test";
import { createServer } from "vite";

// oxlint-disable-next-line typescript/ban-types, typescript/no-empty-object-type -- Only worker-scoped fixtures are added.
export const test = base.extend<{}, { previewServer: boolean }>({
  previewServer: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture dependency list.
    async ({}, use) => {
      if (process.env.FLORA_PREVIEW_URL !== undefined) {
        await use(true);
        return;
      }
      const server = await createServer({
        root: fileURLToPath(new URL("../../", import.meta.url)),
        configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
        mode: "chat-preview",
        server: { host: "127.0.0.1", port: 5199, strictPort: true },
      });
      try {
        await server.listen();
        await use(true);
      } finally {
        await server.close();
      }
    },
    { scope: "worker", auto: true },
  ],
});

export { expect } from "@playwright/test";
