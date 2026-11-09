// oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks use this name; they are not React hooks.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { test as base, expect } from "@playwright/test";

type Backend = { url: string; chatID: string; otherChatID: string };
type WorkerFixtures = { backendBinary: string };

type Fixtures = {
  scenario: "chat" | "changes" | "enrollment" | "notifications" | "projects" | "settings";
  backend: Backend;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  backendBinary: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture dependency list.
    async ({}, use) => {
      if (process.env.FLORA_BROWSER_PREBUILT !== "1") {
        // oxlint-disable-next-line node/no-sync -- Finish the cached build before starting backend processes.
        execFileSync(
          process.execPath,
          [
            fileURLToPath(new URL("../../node_modules/.bin/nx", import.meta.url)),
            "run",
            "backend:browser-build",
            "--output-style=static",
          ],
          {
            cwd: fileURLToPath(new URL("../../", import.meta.url)),
            stdio: "inherit",
          },
        );
      }
      await use(fileURLToPath(new URL("../../bin/browser-fixture", import.meta.url)));
    },
    { scope: "worker", timeout: 120_000 },
  ],
  scenario: ["chat", { option: true }],
  backend: async ({ scenario, backendBinary }, use, testInfo) => {
    const log = await open(testInfo.outputPath("backend.log"), "w");
    const child = spawn(backendBinary, ["-scenario", scenario], {
      stdio: ["pipe", "pipe", log.fd],
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.ok(child.stdout);
    assert.ok(child.stdin);
    const output = createInterface({ input: child.stdout });
    try {
      const message: unknown = await Promise.race([
        once(output, "line", { signal: AbortSignal.timeout(15_000) }),
        exited.then((code) => {
          throw new Error(`Backend exited before startup (${code}); see backend.log`);
        }),
      ]);
      assert.ok(Array.isArray(message));
      const line: unknown = message[0];
      assert.ok(typeof line === "string");
      const data: unknown = JSON.parse(line);
      assert.ok(typeof data === "object" && data !== null);
      assert.ok("url" in data && typeof data.url === "string");
      assert.ok("chatID" in data && typeof data.chatID === "string");
      assert.ok("otherChatID" in data && typeof data.otherChatID === "string");
      await use({ url: data.url, chatID: data.chatID, otherChatID: data.otherChatID });
    } finally {
      output.close();
      child.stdin.end();
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000);
      try {
        expect(await exited, "backend must shut down cleanly; see backend.log").toBe(0);
      } finally {
        clearTimeout(timeout);
        await log.close();
      }
    }
  },
  baseURL: async ({ backend }, use) => {
    await use(backend.url);
  },
});

export { expect } from "@playwright/test";

/** Returns persisted fixture settings, including secrets hidden by the application API. */
export function savedSettingsURL(backend: Backend) {
  return `${backend.url}/__fixture/settings`;
}
