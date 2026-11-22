import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import type { Config, Session, Message, Part } from "@opencode-ai/sdk/v2";

const binary = process.env.OPENCODE_BIN ?? "opencode";
const root = await mkdtemp(join(tmpdir(), "flora-compaction-"));
const workspace = join(root, "workspace");
await mkdir(workspace);
let requests: string[] = [];
let first = true;
const summary = "Remember the project password is marigold. Continue the same task.";
const provider = createServer((req, res) => {
  // oxlint-disable-next-line promise/prefer-await-to-then -- HTTP handlers do not await a returned promise.
  void respond().catch(() => {
    res.writeHead(500);
    res.end();
  });
  async function respond() {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    requests.push(body);
    const compacting = body.includes("Provide a detailed prompt for continuing");
    const input = first ? 30_000 : 100;
    first = false;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (type: string, data: object) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send("message_start", {
      message: {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "fixture",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: input, output_tokens: 0 },
      },
    });
    send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    send("content_block_delta", {
      index: 0,
      delta: {
        type: "text_delta",
        text: compacting ? summary : "The project password is marigold.",
      },
    });
    send("content_block_stop", { index: 0 });
    send("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 10 },
    });
    send("message_stop", {});
    res.end();
  }
});
await new Promise<void>((resolve) => {
  provider.listen(0, "127.0.0.1", resolve);
});
const address = provider.address();
assert.ok(address !== null && typeof address !== "string");
const catalog = join(root, "models.json");
const catalogModel = {
  id: "fixture",
  name: "Fixture",
  release_date: "2026-01-01",
  attachment: false,
  reasoning: false,
  temperature: false,
  tool_call: true,
  options: {},
  limit: { context: 100_000, input: 90_000, output: 8000 },
};
await writeFile(
  catalog,
  JSON.stringify({
    anthropic: {
      id: "anthropic",
      name: "Fixture provider",
      env: ["ANTHROPIC_API_KEY"],
      npm: "@ai-sdk/anthropic",
      models: {
        fixture: catalogModel,
        contextonly: {
          ...catalogModel,
          id: "contextonly",
          limit: { context: 100_000, output: 8000 },
        },
      },
    },
  }),
);
const config = {
  model: "anthropic/fixture",
  small_model: "anthropic/fixture",
  enabled_providers: ["anthropic"],
  permission: "allow",
  share: "disabled",
  autoupdate: false,
  provider: {
    anthropic: {
      options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "offline-fixture" },
    },
  },
};
const env = {
  OPENCODE_MODELS_PATH: catalog,
  PATH: process.env.PATH,
  HOME: root,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
  OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
  OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
};
let child: ReturnType<typeof spawn> | undefined;
function start() {
  child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: workspace,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const running = child;
  return new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(output));
    }, 30_000);
    running.stdout?.on("data", (chunk) => {
      output += String(chunk);
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    running.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });
    running.once("error", reject);
    running.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(output));
    });
  });
}
async function stop() {
  if (!child) return;
  const running = child;
  child = undefined;
  running.kill();
  await new Promise<void>((resolve) => {
    running.once("exit", () => {
      resolve();
    });
  });
}
let base = "";
async function api<T>(path: string, method = "GET", body?: object) {
  const response = await fetch(base + path, {
    method,
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  const value: unknown = await response.json();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture checks returned values at each call site.
  return value as T;
}
async function reserve(value: number) {
  await api("/global/config", "PATCH", { compaction: { reserved: value } });
  // Global updates dispose instances asynchronously. Confirm the next instance reads the setting.
  await api("/instance/dispose", "POST");
  const actual = await api<Config>("/config");
  assert.equal(actual.compaction?.reserved, value);
}
function turn(id: string, model: string, text: string) {
  return api(`/session/${id}/message`, "POST", {
    model: { providerID: "anthropic", modelID: model },
    parts: [{ type: "text", text }],
  });
}
try {
  // oxlint-disable-next-line typescript/strict-void-return -- Node promisify accepts execFile callback overloads.
  const { stdout: version } = await promisify(execFile)(binary, ["--version"], { env });
  assert.equal(version.trim(), "1.2.27");
  base = await start();

  for (const [name, model, reserved, expected] of [
    ["default", "fixture", 8000, false],
    ["custom", "fixture", 65_000, true],
    ["unsupported", "contextonly", 65_000, false],
  ] as const) {
    await reserve(8000);
    requests = [];
    first = true;
    const session = await api<Session>("/session", "POST", { title: name });
    await turn(session.id, model, "Remember the project password is marigold.");
    await reserve(reserved);
    if (name === "custom") {
      await stop();
      base = await start();
      const actual = await api<Config>("/config");
      assert.equal(actual.compaction?.reserved, reserved, "global reserve survives restart");
    }
    await turn(session.id, model, "Continue our project and keep its password.");
    const history = await api<{ info: Message; parts: Part[] }[]>(`/session/${session.id}/message`);

    assert.equal(
      history.some((m) => m.info.role === "assistant" && m.info.summary === true),
      expected,
      name,
    );
    if (expected) {
      assert.ok(requests.some((body) => body.includes("Provide a detailed prompt for continuing")));
      assert.ok(
        requests.at(-1)?.includes(summary) === true,
        "continuation receives the saved summary",
      );
      assert.ok(
        requests.some(
          (body) =>
            body.includes("Provide a detailed prompt for continuing") &&
            body.includes("Continue our project"),
        ),
        "summary request includes the pending user turn",
      );
      assert.ok(
        history.some((m) =>
          m.parts.some(
            (p) => p.type === "text" && p.text === "Remember the project password is marigold.",
          ),
        ),
        "original history remains saved",
      );
    }
    console.log(`${name}: compaction=${expected}; session history retained`);
    await delay(100);
  }
} finally {
  await stop();
  provider.closeAllConnections();
  provider.close();
  await rm(root, { recursive: true, force: true });
}
