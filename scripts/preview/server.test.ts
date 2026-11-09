import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { createServer } from "vite";
import { test } from "vitest";

import { captured } from "./captured.ts";
import { projects as fixtureProjects, stories } from "./scenarios.ts";
import { chatPreview, messages, previewFrameMs, rebaseFrame, type Frame } from "./server.ts";

test("captures match the pinned SDK and cover real OpenCode tool and question states", async () => {
  const image = await readFile(new URL("../../agent/image/Dockerfile", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../../package.json", import.meta.url), "utf8");
  assert.match(image, /opencode:1\.2\.27@sha256:/);
  assert.match(manifest, /"@opencode-ai\/sdk": "1\.2\.27"/);
  const frames: Frame[] = captured.flatMap<Frame>((s) => s.frames);
  const tools = frames
    .flatMap((f) => f.history.flatMap((m) => m.parts))
    .filter((p) => p.type === "tool");
  for (const status of ["running", "completed", "error"]) {
    assert.ok(tools.some((p) => p.state.status === status));
  }
  assert.ok(frames.some((f) => f.questions.length > 0));
  for (const frame of frames) {
    for (const m of frame.history) {
      for (const part of m.parts) {
        assert.equal(part.messageID, m.info.id);
        assert.equal(part.sessionID, m.info.sessionID);
      }
    }
    const saved = messages(frame, "fixture");
    for (const [i, row] of saved.entries()) {
      assert.equal(row.RuntimeMessageID, frame.history[i]?.info.id);
      assert.deepEqual(row.Payload, row.Role === "user" ? {} : frame.history[i]);
      if (row.Role === "user") {
        assert.equal(row.Provider, "");
        assert.doesNotMatch(row.Text, /preview:(completed|waiting|recovery|long)/);
      }
    }
  }
});

test("preview serves isolated fixtures and replays saved events with resumable IDs", async () => {
  const server = await createServer({
    configFile: false,
    plugins: [chatPreview()],
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "silent",
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address !== undefined && address !== null && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();
  try {
    for (const id of [
      "working",
      "completed",
      "waiting",
      "recovery",
      "long",
      "checkout",
      "pagination",
      "focus",
    ]) {
      const response = await fetch(`${base}/api/chats/${id}`);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /"messages":\[/);
      assert.doesNotMatch(text, /preview:(completed|waiting|recovery|long)/);
      assert.match(text, /"HarnessVersion":"1.2.27"/);
    }
    const projectResponse = await fetch(`${base}/api/projects`);
    assert.deepEqual(await projectResponse.json(), fixtureProjects);
    for (const project of fixtureProjects) {
      const detail = await fetch(`${base}/api/projects/${project.id}`);
      assert.equal(detail.status, 200);
      assert.deepEqual(await detail.json(), project);
    }
    const missingProject = await fetch(`${base}/api/projects/missing`);
    assert.equal(missingProject.status, 404);
    const notificationResponse = await fetch(`${base}/api/notifications`);
    const notificationText = await notificationResponse.text();
    for (const project of fixtureProjects) {
      assert.ok(notificationText.includes(`"ProjectID":"${project.id}"`));
    }
    for (const story of stories) {
      const detailResponse = await fetch(`${base}/api/chats/${story.id}`);
      const detailText = await detailResponse.text();
      assert.ok(detailText.includes(`"ProjectID":"${story.projectID}"`));
      assert.ok((detailText.match(/"Role":"user"/g) ?? []).length >= 3);
      const reviewResponse = await fetch(`${base}/api/chats/${story.id}/changes`);
      const reviewText = await reviewResponse.text();
      assert.ok(reviewText.includes(`"number":${story.pull.number}`));
      assert.ok(reviewText.includes(`"state":"${story.pull.state}"`));
      for (const file of story.files) assert.ok(reviewText.includes(file.path));
      await fetch(`${base}/__preview/control?action=restart&chat=${story.id}`, { method: "POST" });
      await fetch(`${base}/__preview/control?action=pause&chat=${story.id}`, { method: "POST" });
      const initialResponse = await fetch(`${base}/api/chats/${story.id}/changes`);
      const initialText = await initialResponse.text();
      assert.match(initialText, /"snapshot":null/);
      assert.match(initialText, /"items":\[\]/);
    }
    const recovery = captured.find((scenario) => scenario.name === "recovery");
    assert.ok(recovery);
    const completedResponse = await fetch(`${base}/api/chats/completed`);
    const completedBefore = await completedResponse.text();
    const restartRecovery = await fetch(`${base}/__preview/control?action=restart&chat=recovery`, {
      method: "POST",
    });
    assert.equal(restartRecovery.status, 200);
    await fetch(`${base}/__preview/control?action=pause&chat=recovery`, { method: "POST" });
    const pausedResponse = await fetch(`${base}/api/chats/recovery`);
    const paused = await pausedResponse.text();
    assert.ok(recovery.frames[0]);
    const pausedDetail: unknown = JSON.parse(paused);
    assert.ok(
      typeof pausedDetail === "object" && pausedDetail !== null && "messages" in pausedDetail,
    );
    assert.ok(Array.isArray(pausedDetail.messages));
    assert.equal(pausedDetail.messages.length, recovery.frames[0].history.length);
    await delay(previewFrameMs + 100);
    const stillPaused = await fetch(`${base}/api/chats/recovery`);
    assert.equal(await stillPaused.text(), paused);
    const unchanged = await fetch(`${base}/api/chats/completed`);
    assert.equal(await unchanged.text(), completedBefore);
    await fetch(`${base}/__preview/control?action=play&chat=recovery`, { method: "POST" });
    await delay(previewFrameMs + 100);
    const resumedRecovery = await fetch(`${base}/api/chats/recovery`);
    assert.notEqual(await resumedRecovery.text(), paused);
    const badControl = await fetch(`${base}/__preview/control?action=restart&chat=unknown`, {
      method: "POST",
    });
    assert.equal(badControl.status, 400);
    const mutation = await fetch(`${base}/api/settings`, { method: "PUT", body: "{}" });
    assert.equal(mutation.status, 405);
    const unknown = await fetch(`${base}/api/unknown`);
    assert.equal(unknown.status, 404);
    const stream = await fetch(`${base}/api/chats/completed/events`, { signal: controller.signal });
    const first = await stream.body?.getReader().read();
    const text = new TextDecoder().decode(first?.value);
    assert.match(text, /event: activity/);
    assert.match(text, /"Kind":"message.runtime"/);
    const resumed = await fetch(`${base}/api/chats/completed/events`, {
      headers: { "Last-Event-ID": "99999" },
      signal: controller.signal,
    });
    const next = await resumed.body?.getReader().read();
    assert.equal(new TextDecoder().decode(next?.value), ": keep-alive\n\n");
    const restart = await fetch(`${base}/__preview/control?action=restart`, { method: "POST" });
    assert.equal(restart.status, 200);
  } finally {
    controller.abort();
    await server.close();
  }
});

test("replay timestamps are fresh without changing recorded durations or inputs", () => {
  const original = captured.find((s) => s.name === "recovery")?.frames.at(-1);
  assert.ok(original);
  const start = original.history[0]?.info.time.created;
  assert.ok(start !== undefined);
  const now = Date.now();
  const offset = now - start;
  const rebased = rebaseFrame(original, offset);
  assert.equal(rebased.history[0]?.info.time.created, now);
  assert.deepEqual(rebaseFrame(rebased, -offset), original);
  for (const [i, message] of original.history.entries()) {
    for (const [j, part] of message.parts.entries()) {
      const shifted = rebased.history[i]?.parts[j];
      if (part.type === "tool" && shifted?.type === "tool") {
        assert.deepEqual(shifted.state.input, part.state.input);
      }
    }
  }
});
