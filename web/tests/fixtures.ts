// oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks use this name; they are not React hooks.
import assert from "node:assert/strict";

import { test as base, expect } from "@playwright/test";

const fixtureURL = "http://127.0.0.1:5198";

type Backend = { id: string; url: string; chatID: string; otherChatID: string };
type Fixtures = {
  scenario: "chat" | "changes" | "enrollment" | "notifications" | "projects" | "settings";
  backend: Backend;
};

export const test = base.extend<Fixtures>({
  scenario: ["chat", { option: true }],
  backend: async ({ playwright, scenario }, use) => {
    const control = await playwright.request.newContext({ baseURL: fixtureURL });
    try {
      const response = await control.post(`/fixtures/${scenario}`);
      await expect(response).toBeOK();
      const data: unknown = await response.json();
      assert.ok(typeof data === "object" && data !== null);
      assert.ok("id" in data && typeof data.id === "string");
      assert.ok("url" in data && typeof data.url === "string");
      assert.ok("chatID" in data && typeof data.chatID === "string");
      assert.ok("otherChatID" in data && typeof data.otherChatID === "string");
      try {
        await use({
          id: data.id,
          url: data.url,
          chatID: data.chatID,
          otherChatID: data.otherChatID,
        });
      } finally {
        const removed = await control.delete(`/fixtures/${data.id}`);
        await expect(removed).toBeOK();
      }
    } finally {
      await control.dispose();
    }
  },
  baseURL: async ({ backend }, use) => {
    await use(backend.url);
  },
});

export { expect } from "@playwright/test";

/** Returns persisted fixture settings, including secrets hidden by the application API. */
export function savedSettingsURL(backend: Backend) {
  return `${fixtureURL}/fixtures/${backend.id}/settings`;
}
