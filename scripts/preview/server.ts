import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Message, Part, QuestionRequest } from "@opencode-ai/sdk/v2";
import type { Plugin } from "vite";

import { captured } from "./captured.ts";

export type Frame = { history: { info: Message; parts: Part[] }[]; questions: QuestionRequest[] };
function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
const scenarios: { id: string; title: string; frames: Frame[] }[] = [
  {
    id: "working",
    title: "Check the project setup",
    frames: present(captured.find((s) => s.name === "completed")).frames,
  },
  ...captured.map((s) => ({
    id: s.name,
    title:
      (
        {
          completed: "Review the workspace changes",
          waiting: "Move project settings into the menu",
          recovery: "Fix the workspace checks",
          long: "Improve keyboard navigation",
        } as Record<string, string>
      )[s.name] ?? s.name,
    frames: s.frames,
  })),
];
const epoch = "2026-01-01T12:00:00.000Z";
const project = {
  id: "preview",
  name: "Example project",
  configuration: {
    repositories: [
      {
        name: "example",
        url: "https://github.com/example/example",
        baseBranch: "main",
        role: "core",
      },
    ],
    setupCommand: "",
  },
};

/** Projects captured OpenCode history into the same saved-message fields as captureHistory and AcceptMessage. */
export function messages(frame: Frame, chatID: string) {
  return frame.history.map(({ info, parts }) => {
    const user = info.role === "user";
    return {
      ID: `saved-${info.id}`,
      ChatID: chatID,
      RequestID: user ? `request-${info.id}` : "",
      RuntimeMessageID: info.id,
      Role: info.role,
      Text: parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(""),
      Provider: user ? "" : info.providerID,
      Model: user ? "" : info.modelID,
      CreatedAt: epoch,
      Payload: user ? {} : { info, parts },
    };
  });
}

export function chatAt(id: string, frame: Frame, finished: boolean) {
  let status = finished ? "idle" : "working";
  let reason = finished ? "Turn completed; ready for a follow-up" : "Running";
  if (frame.questions.length > 0) {
    status = "waiting";
    reason = "Waiting for your answer";
  }
  return {
    ID: id,
    ProjectID: project.id,
    Title: present(scenarios.find((s) => s.id === id)).title,
    Configuration: project.configuration,
    ImageDigest: `flora-preview@sha256:${"0".repeat(64)}`,
    HarnessVersion: "1.2.27",
    ContainerID: "preview",
    SessionID: frame.history[0]?.info.sessionID ?? "",
    Status: status,
    StatusReason: reason,
    ActiveMessageID: status === "idle" ? "" : `saved-${frame.history[0]?.info.id}`,
    CreatedAt: epoch,
    UpdatedAt: epoch,
    StartingCommits: { example: "a".repeat(40) },
  };
}

/** The dev server owns only in-memory playback. Every API request is handled here, never proxied to a real installation. */
export function chatPreview(): Plugin {
  let frameIndex = 0;
  let playing = false;
  let lastTick = Date.now();
  const streams = new Set<ServerResponse>();
  function index(id: string) {
    const scenario = present(scenarios.find((s) => s.id === id));
    if (id !== "working") return scenario.frames.length - 1;
    if (playing) {
      const now = Date.now();
      frameIndex = Math.min(
        frameIndex + Math.floor((now - lastTick) / 700),
        scenario.frames.length - 1,
      );
      if (now - lastTick >= 700) lastTick = now;
      if (frameIndex === scenario.frames.length - 1) playing = false;
    }
    return frameIndex;
  }
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep response handling with the preview middleware.
  function json(res: ServerResponse, value: unknown, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  }
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/__preview/control" && req.method === "POST") {
      const action = url.searchParams.get("action");
      if (action === "restart") frameIndex = 0;
      playing = action === "play" || action === "restart";
      lastTick = Date.now();
      // Reconnect from zero after a rewind so the frontend discards the prior timeline on reload.
      if (action === "restart") for (const stream of streams) stream.end();
      json(res, { frameIndex, playing });
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    if (req.method !== "GET") {
      json(
        res,
        { error: "Preview data is read-only. Use the preview controls to replay captured work." },
        405,
      );
      return;
    }
    if (url.pathname === "/api/auth/status") {
      json(res, { authenticated: true, setupRequired: false });
      return;
    }
    if (url.pathname === "/api/settings") {
      json(res, {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        githubConfigured: true,
        providerConfigured: true,
        preferences: {
          cpus: 2,
          memoryBytes: 4_294_967_296,
          pidsLimit: 512,
          setupSeconds: 600,
          authorName: "Flora",
          authorEmail: "flora@example.com",
          maxRunning: 3,
          activitySeconds: 3600,
          inlineDiffBytes: 65_536,
          messageBytes: 131_072,
          sessionSeconds: 604_800,
          sound: false,
        },
      });
      return;
    }
    if (url.pathname === "/api/projects") {
      json(res, [project]);
      return;
    }
    if (url.pathname === "/api/notifications") {
      json(res, {
        chats: scenarios.map((s) => {
          const i = index(s.id);
          return chatAt(s.id, present(s.frames[i]), i === s.frames.length - 1);
        }),
        completions: [],
        cursor: 0,
      });
      return;
    }
    const match = /^\/api\/chats\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    const scenario = scenarios.find((s) => s.id === match?.[1]);
    if (!scenario) {
      json(res, { error: "No preview fixture for this endpoint." }, 404);
      return;
    }
    const { id } = scenario;
    const i = index(id);
    const frame = present(scenario.frames[i]);
    const endpoint = match?.[2];
    if (endpoint === undefined) {
      json(res, {
        chat: chatAt(id, frame, i === scenario.frames.length - 1),
        messages: messages(frame, id),
        continuationBlockedReason: "",
      });
      return;
    }
    if (endpoint === "questions") {
      json(res, frame.questions);
      return;
    }
    if (endpoint === "changes") {
      json(res, {
        snapshot:
          i === scenario.frames.length - 1 && id !== "waiting"
            ? {
                id: "preview-review",
                capturedAt: epoch,
                base: "a".repeat(40),
                files: [
                  {
                    path: "example.ts",
                    status: "M",
                    binary: false,
                    undisplayable: false,
                    diff: '@@ -1 +1 @@\n-export const greeting = "Hi";\n+export const greeting = "Hello";\n',
                    bytes: 89,
                    truncated: false,
                  },
                ],
              }
            : null,
        stale: false,
        error: "",
        pulls: { items: [], error: "", checkedAt: epoch },
      });
      return;
    }
    if (endpoint === "events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      streams.add(res);
      let sequence = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
      const send = () => {
        let seq = 0;
        const seen = new Map<string, string>();
        const until = index(id);
        for (const snapshot of scenario.frames.slice(0, until + 1)) {
          for (const message of messages(snapshot, id).filter((m) => m.Role === "assistant")) {
            const serialized = JSON.stringify(message.Payload);
            if (seen.get(message.RuntimeMessageID) === serialized) continue;
            seen.set(message.RuntimeMessageID, serialized);
            seq++;
            if (seq <= sequence) continue;
            const row = {
              Sequence: seq,
              ChatID: id,
              EventID: `preview-${seq}`,
              Kind: "message.runtime",
              CreatedAt: epoch,
              Payload: { ...message, ID: "", CreatedAt: "" },
            };
            res.write(`id: ${seq}\nevent: activity\ndata: ${JSON.stringify(row)}\n\n`);
            sequence = seq;
          }
        }
        res.write(": keep-alive\n\n");
      };
      send();
      const timer = setInterval(send, 250);
      res.on("close", () => {
        clearInterval(timer);
        streams.delete(res);
      });
      return;
    }
    json(res, { error: "No preview fixture for this endpoint." }, 404);
  };
  return {
    name: "flora-chat-preview",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(handler);
      server.httpServer?.on("close", () => {
        for (const stream of streams) stream.end();
      });
    },
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: {
            type: "module",
            src: `/@fs/${new URL("toolbar.js", import.meta.url).pathname}`,
          },
          injectTo: "body",
        },
      ];
    },
  };
}
