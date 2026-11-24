// oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks are not React hooks.
import { fileURLToPath } from "node:url";

import { test as base, expect, type Page } from "@playwright/test";
import { createServer } from "vite";

import { detailSchema } from "../../src/chat-schemas.ts";

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

/** Resolve the fixture's internal key through the API before checking canonical navigation. */
export async function publicChatID(
  page: Page,
  id: string,
  origin = process.env.FLORA_PREVIEW_URL ?? "http://127.0.0.1:5199",
) {
  const response = await page.request.get(
    new URL(`/api/chats/${encodeURIComponent(id)}`, origin).href,
  );
  await expect(response).toBeOK();
  const { chat } = detailSchema.parse(await response.json());
  expect(chat.ID).toBe(id);
  return chat.PublicID;
}
