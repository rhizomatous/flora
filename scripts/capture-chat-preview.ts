import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import type { Config, Session, Message, Part, QuestionRequest } from "@opencode-ai/sdk/v2";

const binary = process.env.OPENCODE_BIN ?? "opencode";
// oxlint-disable-next-line typescript/strict-void-return -- Node promisify accepts the callback-based execFile overload.
const { stdout: versionOutput } = await promisify(execFile)(binary, ["--version"]);
const version = versionOutput.trim();
assert.equal(version, "1.2.27", "Use the OpenCode version pinned in agent/image/Dockerfile");
const root = await mkdtemp(join(tmpdir(), "flora-preview-capture-"));
const workspace = join(root, "workspace");
await mkdir(workspace);
await writeFile(join(workspace, "example.ts"), 'export const greeting = "Hello";\n');
const calls = new Map<string, number>();
const provider = createServer((req, res) => {
  // oxlint-disable-next-line promise/prefer-await-to-then -- The HTTP callback cannot return a promise.
  void respond().catch(() => {
    res.writeHead(500);
    res.end();
  });
  async function respond() {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const scenario =
      ["completed", "waiting", "recovery", "long"].find((s) => body.includes(`preview:${s}`)) ??
      "completed";
    const n = (calls.get(scenario) ?? 0) + 1;
    calls.set(scenario, n);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (type: string, data: object) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send("message_start", {
      message: {
        id: `msg_fixture_${scenario}_${n}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-sonnet-4-6",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    });
    let tool = "";
    let input: object = {};
    if (n === 1 && scenario === "waiting") {
      tool = "question";
      input = {
        questions: [
          {
            header: "Navigation",
            question: "Where should project settings live?",
            options: [
              { label: "Workspace menu", description: "Keep the sidebar focused on chats." },
              { label: "Sidebar", description: "Keep settings visible at all times." },
            ],
            multiple: false,
            custom: true,
          },
        ],
      };
    } else if (n === 1 && scenario === "recovery") {
      tool = "read";
      input = { filePath: join(workspace, "missing.ts") };
    } else if (n === 1 || (n === 2 && scenario === "recovery")) {
      tool = "bash";
      input = {
        command: String.raw`printf 'Checking workspace\n'; sleep 2; printf 'Checks passed\n'`,
        description: "Check workspace",
        timeout: 10_000,
      };
    }
    if (tool) {
      send("content_block_start", {
        index: 0,
        content_block: { type: "tool_use", id: `toolu_${scenario}_${n}`, name: tool, input: {} },
      });
      send("content_block_delta", {
        index: 0,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
      });
    } else {
      const paragraph =
        'The workspace checks passed.\n\n## What changed\n\n- Kept project navigation compact.\n- Preserved keyboard focus and readable labels.\n\n```ts\nexport const greeting = "Hello";\n```\n\nSee [the example](https://example.com) for context.\n\n';
      const text =
        scenario === "long"
          ? Array.from({ length: 8 }, (_, i) => `### Review ${i + 1}\n\n${paragraph}`).join("")
          : (scenario === "recovery"
              ? "The first file path was missing. I recovered and completed the workspace check.\n\n"
              : "") + paragraph;
      send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      for (const chunk of text.match(/.{1,100}/gs) ?? []) {
        send("content_block_delta", { index: 0, delta: { type: "text_delta", text: chunk } });
        await delay(20);
      }
    }
    send("content_block_stop", { index: 0 });
    send("message_delta", {
      delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null },
      usage: { output_tokens: 150 },
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
// oxlint-disable-next-line typescript/no-unsafe-assignment -- This reads the committed OpenCode configuration.
const config: Config = JSON.parse(
  await readFile(new URL("../agent/image/opencode.json", import.meta.url), "utf8"),
);
config.provider = {
  anthropic: {
    options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "offline-fixture" },
  },
};
const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
  cwd: workspace,
  env: {
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
    OPENCODE_ENABLE_QUESTION_TOOL: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  const base = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`OpenCode startup timed out: ${output}`));
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(output));
    });
  });
  console.log(`OpenCode ready at ${base}`);
  const api = async <T>(path: string, body?: object) => {
    const response = await fetch(
      base + path,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
          }
        : { signal: AbortSignal.timeout(10_000) },
    );
    assert.ok(response.ok, `${path}: ${response.status}`);
    const text = await response.text();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Captured output is checked against SDK types when the generated module compiles.
    return (text ? JSON.parse(text) : null) as T;
  };
  const scenarios = [];
  for (const name of ["completed", "waiting", "recovery", "long"]) {
    console.log(`Capturing ${name}`);
    const session = await api<Session>("/session", { title: `Preview ${name}` });
    const prompt = `preview:${name} Please inspect the example project and explain the result.`;
    const pending = api(`/session/${session.id}/message`, {
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      parts: [{ type: "text", text: prompt }],
    });
    const progress = { done: false };
    // oxlint-disable-next-line promise/prefer-await-to-then, unicorn/prefer-top-level-await -- Poll snapshots while the prompt is in flight.
    const completion = pending.then(() => {
      progress.done = true;
      return true;
    });
    const frames = [];
    for (let tick = 0; tick < 200; tick++) {
      await delay(100);
      const history = await api<{ info: Message; parts: Part[] }[]>(
        `/session/${session.id}/message`,
      );
      const pendingQuestions = await api<QuestionRequest[]>("/question");
      const questions = pendingQuestions.filter(
        (q: { sessionID: string }) => q.sessionID === session.id,
      );
      const frame = { history, questions };
      if (JSON.stringify(frame) !== JSON.stringify(frames.at(-1))) frames.push(frame);
      if (questions.length > 0 || progress.done) break;
    }
    assert.ok(frames.length > 0 && (progress.done || name === "waiting"), `${name} did not finish`);
    if (name === "long") {
      await completion;
      await api(`/session/${session.id}/message`, {
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
        parts: [
          {
            type: "text",
            text: "Can you walk through the keyboard behavior and show another example?",
          },
        ],
      });
      const history = await api<{ info: Message; parts: Part[] }[]>(
        `/session/${session.id}/message`,
      );
      frames.push({ history, questions: [] });
    }
    console.log(`Captured ${name}: ${frames.length} frames`);
    scenarios.push({ name, frames });
    if (name === "waiting") {
      const questions = await api<QuestionRequest[]>("/question");
      for (const q of questions) {
        await api(`/question/${q.id}/reply`, { answers: [["Workspace menu"]] });
      }
    }
    await completion;
  }
  // Only the isolated temporary workspace path is normalized; message/part payloads come from OpenCode.
  const serialized = JSON.stringify(scenarios, null, 2).replaceAll(workspace, "/workspace");
  await writeFile(
    new URL("preview/captured.ts", import.meta.url),
    `/* oxlint-disable unicorn/numeric-separators-style, unicorn/prefer-string-raw -- Preserve serialized OpenCode payloads. */\n// Generated by npm run preview:capture using OpenCode ${version} and a local deterministic provider.\nimport type { Message, Part, QuestionRequest } from "@opencode-ai/sdk/v2";\n\nexport const captured = ${serialized} satisfies { name: string; frames: { history: { info: Message; parts: Part[] }[]; questions: QuestionRequest[] }[] }[];\n`,
  );
  console.log(`Captured ${scenarios.length} scenarios from OpenCode ${version}.`);
} finally {
  child.kill();
  provider.closeAllConnections();
  provider.close();
  await rm(root, { recursive: true, force: true });
}
