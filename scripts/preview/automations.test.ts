import assert from "node:assert/strict";

import { createServer } from "vite";
import { test } from "vitest";

import {
  automationSchema,
  automationDetailSchema,
  automationRunSchema,
} from "../../web/src/automation-schemas.ts";
import { detailSchema, feedSchema } from "../../web/src/chat-schemas.ts";
import { previewNextRun } from "./automations.ts";
import { projects, scenarios } from "./scenarios.ts";
import { chatPreview } from "./server.ts";

test("automations share demo chats and simulate isolated, editable runs", async () => {
  const server = await createServer({
    configFile: false,
    plugins: [chatPreview()],
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "silent",
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address !== undefined && address !== null && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/`;
  async function call(
    path: string,
    input?: unknown,
    method = input === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(base + path, {
      method,
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json() as Promise<unknown>;
  }
  try {
    const feed = feedSchema.parse(await call("notifications"));
    assert.deepEqual(
      feed.chats.map((chat) => chat.ID),
      scenarios.map((scenario) => scenario.id),
    );
    const list = automationSchema.array().parse(await call("automations"));
    assert.equal(list.length, 3);
    for (const item of list) {
      assert.ok(projects.some((project) => project.id === item.projectID));
      const detail = automationDetailSchema.parse(await call(`automations/${item.id}`));
      for (const run of detail.runs) {
        const chat = detailSchema.parse(await call(`chats/${run.chatID}`));
        assert.equal(chat.chat.ProjectID, item.projectID);
        assert.ok(chat.messages.some((message) => message.ID === run.messageID));
        assert.ok(chat.automationRuns.some((saved) => saved.id === run.id));
      }
    }
    const prior = detailSchema.parse(await call("chats/focus"));
    const shared = automationRunSchema.parse(
      await call("automations/accessibility/run", { requestID: "same-run" }),
    );
    assert.equal(shared.chatID, "focus");
    const after = detailSchema.parse(await call("chats/focus"));
    assert.deepEqual(after.messages.slice(0, prior.messages.length), prior.messages);
    assert.ok(after.messages.some((message) => message.ID === shared.messageID));
    assert.match(after.messages.at(-1)?.Text ?? "", /Simulated automation run/);
    assert.deepEqual(
      await call("automations/accessibility/run", { requestID: "same-run" }),
      shared,
    );
    const skipped = automationRunSchema.parse(
      await call("automations/settings-review/run", { requestID: "blocked" }),
    );
    assert.equal(skipped.status, "skipped");
    const created = automationSchema.parse(
      await call("automations", {
        name: "Daily checks",
        projectID: "garden",
        instructions: "Check the app",
        enabled: true,
        mode: "new",
        frequency: "daily",
        days: [],
        time: "09:00",
        timeZone: "UTC",
      }),
    );
    const paused = automationSchema.parse(
      await call(`automations/${created.id}`, { ...created, enabled: false }, "PUT"),
    );
    assert.equal(paused.enabled, false);
    const run = automationRunSchema.parse(
      await call(`automations/${created.id}/run`, { requestID: "fresh-run" }),
    );
    assert.notEqual(run.chatID, "focus");
    const fresh = detailSchema.parse(await call(`chats/${run.chatID}`));
    assert.equal(fresh.chat.ProjectID, "garden");
    assert.equal(fresh.messages[0]?.Text, "Check the app");
    const changes = await call(`chats/${run.chatID}/changes`);
    assert.ok(typeof changes === "object" && changes !== null && "snapshot" in changes);
    assert.ok(
      typeof changes.snapshot === "object" &&
        changes.snapshot !== null &&
        "files" in changes.snapshot,
    );
    assert.deepEqual(changes.snapshot.files, []);
    const updatedFeed = feedSchema.parse(await call("notifications"));
    assert.equal(updatedFeed.chats.length, feed.chats.length + 1);
    const unknown = await fetch(`${base}unknown`);
    assert.equal(unknown.status, 404);
    const mutation = await fetch(`${base}settings`, { method: "PUT", body: "{}" });
    assert.equal(mutation.status, 405);
    assert.equal(
      scenarios.length,
      feed.chats.length,
      "mutations must not change the shared fixture definitions",
    );
  } finally {
    await server.close();
  }
});

test("preview schedule uses local time through daylight saving changes", () => {
  const schedule = {
    frequency: "daily" as const,
    days: [],
    time: "09:00",
    timeZone: "America/New_York",
  };
  assert.equal(
    previewNextRun(schedule, new Date("2026-03-07T15:00:00Z")),
    "2026-03-08T13:00:00.000Z",
  );
  assert.equal(
    previewNextRun({ ...schedule, time: "01:30" }, new Date("2026-11-01T05:30:00Z")),
    "2026-11-02T06:30:00.000Z",
  );
});
