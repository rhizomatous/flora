import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Message, Part, QuestionRequest } from "@opencode-ai/sdk/v2";
import type { Plugin } from "vite";

import { PreviewAutomations } from "./automations.ts";
import { previewPullChecks } from "./check-fixtures.ts";
import { paginationDiffFiles } from "./diff-fixtures.ts";
import {
  projects,
  stories,
  scenarios as demoScenarios,
  conversation,
  subagentFixtures,
} from "./scenarios.ts";
import { previewUsage } from "./usage.ts";

export type Frame = { history: { info: Message; parts: Part[] }[]; questions: QuestionRequest[] };
function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
export const previewFrameMs = 2500;

// Shift only runtime timestamps; file ranges and tool inputs retain their recorded values.
export function rebaseFrame(frame: Frame, offset: number): Frame {
  const rebased = structuredClone(frame);
  for (const { info, parts } of rebased.history) {
    info.time.created += offset;
    if (info.role === "assistant" && info.time.completed !== undefined) {
      info.time.completed += offset;
    }
    for (const part of parts) {
      let time = "time" in part ? part.time : undefined;
      if (part.type === "tool" && part.state.status !== "pending") time = part.state.time;
      if (time === undefined) continue;
      if ("created" in time) time.created += offset;
      if ("start" in time) time.start += offset;
      if ("end" in time && typeof time.end === "number") time.end += offset;
      if ("compacted" in time && typeof time.compacted === "number") time.compacted += offset;
    }
  }
  return rebased;
}

function replayFrames(frames: Frame[]) {
  const start = frames[0]?.history[0]?.info.time.created ?? Date.now();
  const offset = Date.now() - start;
  return frames.map((frame) => rebaseFrame(frame, offset));
}

const epoch = "2026-01-01T12:00:00.000Z";
const publicIDs = new Map<string, string>();
function publicID(id: string, projectName: string) {
  const prefix =
    projectName
      .replaceAll(/[^A-Za-z]/gu, "")
      .toUpperCase()
      .slice(0, 4) || "CHAT";
  if (!publicIDs.has(id)) publicIDs.set(id, `${prefix}-${publicIDs.size + 1}`);
  return present(publicIDs.get(id));
}

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
      CreatedAt: new Date(info.time.created).toISOString(),
      Payload: user ? {} : { info, parts },
    };
  });
}

function subagentSnapshots(frame: Frame) {
  const snapshots = new Map<
    string,
    {
      agent: {
        id: string;
        number: number;
        parentID: string;
        title: string;
        status: string;
        collection: string;
        created: number;
        updatedAt: string;
      };
      frame: Frame;
    }
  >();
  for (const message of frame.history) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.state.status === "pending") continue;
      const { state } = part;
      const fixture = subagentFixtures.find((agent) => agent.id === state.metadata?.sessionId);
      if (!fixture) continue;
      const finished = part.state.status === "completed";
      const child = present(fixture.frames[finished ? fixture.frames.length - 1 : 3]);
      const offset =
        part.state.time.start - present(fixture.frames[0]?.history[0]).info.time.created;
      snapshots.set(fixture.id, {
        agent: {
          id: fixture.id,
          number: fixture.number,
          parentID: message.info.sessionID,
          title: fixture.title,
          status: finished ? "idle" : "working",
          collection: "complete",
          created: part.state.time.start,
          updatedAt: new Date(
            state.status === "completed" ? state.time.end : state.time.start,
          ).toISOString(),
        },
        frame: rebaseFrame(child, offset),
      });
    }
  }
  return [...snapshots.values()];
}

export function chatAt(scenario: (typeof demoScenarios)[number], frame: Frame, finished: boolean) {
  const { id } = scenario;
  const project = present(projects.find((p) => p.id === scenario.projectID));
  let status = finished ? "idle" : "working";
  let reason = finished ? "Turn completed; ready for a follow-up" : "Running";
  if (frame.questions.length > 0) {
    status = "waiting";
    reason = "Waiting for your answer";
  }
  return {
    subagents: subagentSnapshots(frame).map(({ agent }) => agent),
    pulls: {
      items: finished
        ? (stories.find((s) => s.id === id)?.pulls ?? []).map((pull) => previewPullChecks(pull))
        : [],
      error: "",
      checkedAt: epoch,
    },
    ID: id,
    PublicID: publicID(id, project.name),
    ProjectID: project.id,
    Title: scenario.title,
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
    StartingCommits: Object.fromEntries(
      project.configuration.repositories.map((repo) => [repo.name, "a".repeat(40)]),
    ),
  };
}

/** The dev server owns only in-memory playback. Every API request is handled here, never proxied to a real installation. */
export function chatPreview(): Plugin {
  const scenarios = structuredClone(demoScenarios);
  const checkModes = new Map<string, string>();
  function currentChat(scenario: (typeof demoScenarios)[number], frame: Frame, finished: boolean) {
    const chat = chatAt(scenario, frame, finished);
    chat.pulls.items = chat.pulls.items.map((pull) =>
      previewPullChecks(pull, checkModes.get(scenario.id)),
    );
    return chat;
  }
  const playback = new Map(
    scenarios.map((scenario) => [
      scenario.id,
      {
        frames: replayFrames(scenario.frames),
        frameIndex: scenario.id === "working" ? 0 : scenario.frames.length - 1,
        playing: false,
        lastTick: Date.now(),
      },
    ]),
  );
  const streams = new Map<ServerResponse, string>();
  function index(id: string) {
    const scenario = present(scenarios.find((s) => s.id === id));
    const state = present(playback.get(id));
    if (state.playing) {
      const now = Date.now();
      const ticks = Math.floor((now - state.lastTick) / previewFrameMs);
      state.frameIndex = Math.min(state.frameIndex + ticks, scenario.frames.length - 1);
      state.lastTick += ticks * previewFrameMs;
      if (state.frameIndex === scenario.frames.length - 1) state.playing = false;
    }
    return state.frameIndex;
  }
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep response handling with the preview middleware.
  function json(res: ServerResponse, value: unknown, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  }
  const automations = new PreviewAutomations((automation, runID) => {
    const existing =
      automation.mode === "same" ? scenarios.find((s) => s.id === automation.chatID) : undefined;
    if (existing) {
      const state = present(playback.get(existing.id));
      const frame = present(state.frames[index(existing.id)]);
      if (frame.questions.length > 0 || index(existing.id) < existing.frames.length - 1) {
        return null;
      }
    }
    const id = existing?.id ?? `automation-${runID}`;
    const frames = replayFrames(
      conversation(runID, [
        {
          user: automation.instructions,
          steps: [
            {
              text: "Simulated automation run completed. This preview does not execute tools, change repository files, or open pull requests.",
            },
          ],
        },
      ]),
    );
    const newFrame = present(frames.at(-1));
    const messageID = `saved-${present(newFrame.history[0]).info.id}`;
    if (existing) {
      const previous = present(playback.get(id));
      const previousFrame = present(previous.frames.at(-1));
      const { sessionID } = present(previousFrame.history[0]).info;
      for (const message of newFrame.history) {
        message.info.sessionID = sessionID;
        for (const part of message.parts) part.sessionID = sessionID;
      }
      newFrame.history.unshift(...previousFrame.history);
      existing.frames = [newFrame];
    } else {
      scenarios.push({
        id,
        projectID: automation.projectID,
        title: automation.name,
        frames: [newFrame],
      });
    }
    playback.set(id, { frames: [newFrame], frameIndex: 0, playing: false, lastTick: Date.now() });
    for (const [stream, chatID] of streams) if (chatID === id) stream.end();
    return { chatID: id, messageID };
  });
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    for (const scenario of scenarios) {
      const canonical = publicID(
        scenario.id,
        present(projects.find((project) => project.id === scenario.projectID)).name,
      );
      if (
        url.pathname === `/api/chats/${canonical}` ||
        url.pathname.startsWith(`/api/chats/${canonical}/`)
      ) {
        url.pathname = url.pathname.replace(`/api/chats/${canonical}`, `/api/chats/${scenario.id}`);
      }
      if (url.searchParams.get("chat") === canonical) url.searchParams.set("chat", scenario.id);
    }
    if (url.pathname === "/__preview/checks" && (req.method === "POST" || req.method === "GET")) {
      const chat = url.searchParams.get("chat") ?? "";
      const state = url.searchParams.get("state") ?? "saved";
      if (
        !scenarios.some((scenario) => scenario.id === chat) ||
        !["saved", "pending", "success", "failure", "stale"].includes(state)
      ) {
        json(res, { error: "Unknown preview chat or check state." }, 400);
        return;
      }
      if (req.method === "POST") checkModes.set(chat, state);
      json(res, { chat, state: checkModes.get(chat) ?? "saved" });
      return;
    }
    if (url.pathname === "/__preview/control" && req.method === "POST") {
      const action = url.searchParams.get("action");
      const id = url.searchParams.get("chat") ?? "working";
      const state = playback.get(id);
      if (!state || !["restart", "play", "pause"].includes(action ?? "")) {
        json(res, { error: "Unknown preview chat or action." }, 400);
        return;
      }
      index(id);
      if (action === "restart") {
        state.frameIndex = 0;
        state.frames = replayFrames(present(scenarios.find((s) => s.id === id)).frames);
      }
      state.playing = action === "play" || action === "restart";
      state.lastTick = Date.now();
      // Only the rewound chat reconnects; other previews keep their position and event cursor.
      if (action === "restart") {
        for (const [stream, chatID] of streams) if (chatID === id) stream.end();
      }
      json(res, { chat: id, frameIndex: state.frameIndex, playing: state.playing });
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    if (url.pathname === "/api/automations" || url.pathname.startsWith("/api/automations/")) {
      // oxlint-disable-next-line promise/prefer-await-to-then -- Connect middleware does not await handlers.
      void automations.handle(req, res, url).catch(() => {
        json(res, { error: "Invalid preview automation request." }, 400);
      });
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
    if (url.pathname === "/api/models") {
      const chatID = url.searchParams.get("chat");
      if (chatID !== null && !scenarios.some((scenario) => scenario.id === chatID)) {
        json(res, { error: "Unknown preview chat." }, 404);
        return;
      }
      json(res, {
        default: { provider: "anthropic", model: "claude-sonnet-4-6", variant: "" },
        models: [
          {
            provider: "anthropic",
            id: "claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            variants: ["low", "medium", "high", "max"],
            image: true,
            pdf: true,
            inputPrice: 3,
            outputPrice: 15,
          },
        ],
        error: "",
      });
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
    if (url.pathname === "/api/settings/environment") {
      json(res, []);
      return;
    }
    if (url.pathname === "/api/folders") {
      json(res, []);
      return;
    }
    if (url.pathname === "/api/usage") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      json(res, previewUsage(from, to));
      return;
    }
    if (url.pathname === "/api/projects") {
      json(res, projects);
      return;
    }
    const projectEnvironment = /^\/api\/projects\/([^/]+)\/environment(?:\/effective)?$/.exec(
      url.pathname,
    );
    if (projectEnvironment) {
      const project = projects.find((p) => p.id === projectEnvironment[1]);
      json(res, project ? [] : { error: "Unknown preview project." }, project ? 200 : 404);
      return;
    }
    const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
    if (projectMatch) {
      const project = projects.find((p) => p.id === projectMatch[1]);
      json(res, project ?? { error: "Unknown preview project." }, project ? 200 : 404);
      return;
    }
    if (url.pathname === "/api/notifications") {
      json(res, {
        chats: scenarios.map((s) => {
          const i = index(s.id);
          const state = present(playback.get(s.id));
          return currentChat(s, present(state.frames[i]), i === s.frames.length - 1);
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
    const replay = present(playback.get(id));
    const frame = present(replay.frames[i]);
    const endpoint = match?.[2];
    if (endpoint === "environment") {
      json(res, []);
      return;
    }
    if (endpoint === undefined) {
      json(res, {
        chat: currentChat(scenario, frame, i === scenario.frames.length - 1),
        messages: messages(frame, id),
        subagents: subagentSnapshots(frame).map(({ agent }) => agent),
        continuationBlockedReason: "",
        automationRuns: automations.forChat(id),
        contextUsage: frame.history.some(
          ({ info }) => info.role === "assistant" && info.time.completed !== undefined,
        )
          ? { tokens: 79_600, limit: 200_000, provider: "anthropic", model: "claude-sonnet-4-6" }
          : { tokens: null, limit: null, provider: "", model: "" },
      });
      return;
    }
    if (endpoint === "compaction") {
      json(res, {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        threshold: null,
        default: 168_000,
        maximum: null,
        reason:
          "This model has no explicit input limit. OpenCode 1.2.27 ignores custom compaction reserves for it.",
      });
      return;
    }
    if (endpoint.startsWith("subagents/")) {
      const child = subagentSnapshots(frame).find(({ agent }) => agent.id === endpoint.slice(10));
      json(
        res,
        child ? { messages: messages(child.frame, id) } : { error: "Unknown preview subagent." },
        child ? 200 : 404,
      );
      return;
    }
    if (endpoint === "questions") {
      json(res, frame.questions);
      return;
    }
    if (endpoint === "changes") {
      const story = stories.find((s) => s.id === id);
      const finished = i === scenario.frames.length - 1;
      const project = present(projects.find((p) => p.id === scenario.projectID));
      const repository = present(project.configuration.repositories[0]);
      const files = (story?.files ?? (id.startsWith("automation-") ? [] : undefined))?.map(
        (file) => {
          const before = file.before.split("\n");
          const after = file.after.split("\n");
          const lines: string[] = [];
          for (let lineIndex = 0; lineIndex < Math.max(before.length, after.length); lineIndex++) {
            if (before[lineIndex] === after[lineIndex]) lines.push(` ${before[lineIndex]}`);
            else {
              if (before[lineIndex] !== undefined) lines.push(`-${before[lineIndex]}`);
              if (after[lineIndex] !== undefined) lines.push(`+${after[lineIndex]}`);
            }
          }
          const diff = `@@ -1,${before.length} +1,${after.length} @@\n${lines.join("\n")}\n`;
          return {
            repository: repository.name,
            path: file.path,
            status: "M",
            binary: false,
            undisplayable: false,
            diff,
            additions: lines.filter((line) => line.startsWith("+")).length,
            deletions: lines.filter((line) => line.startsWith("-")).length,
            bytes: Buffer.byteLength(diff),
            truncated: false,
          };
        },
      );
      if (id === "pagination" && files) {
        for (const file of paginationDiffFiles) {
          const lines = file.diff.split("\n");
          files.push({
            repository: repository.name,
            ...file,
            status: "M",
            binary: false,
            undisplayable: false,
            additions: lines.filter((line) => line.startsWith("+")).length,
            deletions: lines.filter((line) => line.startsWith("-")).length,
            bytes: Buffer.byteLength(file.diff),
            truncated: false,
          });
        }
      }
      json(res, {
        snapshot:
          i === scenario.frames.length - 1 && id !== "waiting"
            ? {
                id: "preview-review",
                capturedAt: epoch,
                base: "a".repeat(40),
                files: files ?? [
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
        pulls: {
          items: story && finished ? story.pulls : [],
          error: "",
          checkedAt: epoch,
        },
      });
      return;
    }
    if (endpoint === "events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      streams.set(res, id);
      let sequence = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
      const send = () => {
        let seq = 0;
        const seen = new Map<string, string>();
        const until = index(id);
        for (const snapshot of replay.frames.slice(0, until + 1)) {
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
        for (const stream of streams.keys()) stream.end();
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
