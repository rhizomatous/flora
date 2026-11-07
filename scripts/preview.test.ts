import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createServer } from "vite";

import { captured } from "./preview/captured.ts";
import { chatPreview, messages, type Frame } from "./preview/server.ts";

test("captures match the pinned SDK and cover real OpenCode tool and question states", async () => {
  const image = await readFile(new URL("../agent/image/Dockerfile", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../package.json", import.meta.url), "utf8");
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
      if (row.Role === "user") assert.equal(row.Provider, "");
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
    for (const id of ["working", "completed", "waiting", "recovery", "long"]) {
      const response = await fetch(`${base}/api/chats/${id}`);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /"messages":\[/);
      assert.match(text, /"HarnessVersion":"1.2.27"/);
    }
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
