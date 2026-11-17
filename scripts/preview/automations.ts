import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import {
  automationSchema,
  type Automation,
  type AutomationDetail,
} from "../../web/src/automation-schemas.ts";
import { projects, scenarios } from "./scenarios.ts";

type Run = AutomationDetail["runs"][number];
const inputSchema = automationSchema
  .omit({ id: true, nextRun: true, chatID: true, latestRun: true })
  .extend({
    revision: z.number().default(0),
    name: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(131_072),
  });
const scheduleSchema = automationSchema.pick({
  frequency: true,
  days: true,
  time: true,
  timeZone: true,
});

/** Finds a local wall-clock occurrence for display only. The preview never starts timers or real work. */
export function previewNextRun(input: z.infer<typeof scheduleSchema>, after = new Date()) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error("Invalid time");
  if (input.frequency === "weekly" && (input.days?.length ?? 0) === 0) {
    throw new Error("Select a day");
  }
  if ((input.days ?? []).some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Invalid day");
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const seen = new Set<string>();
  // Include the preceding day so the repeated fall-back hour is considered once.
  const start = Math.floor(after.getTime() / 60_000) * 60_000 - 26 * 3_600_000;
  for (let at = start; at < start + 17 * 86_400_000; at += 60_000) {
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map((part) => [part.type, part.value]),
    );
    if (`${parts.hour}:${parts.minute}` !== input.time) continue;
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (seen.has(date)) continue;
    seen.add(date);
    const day = weekdays.indexOf(parts.weekday ?? "");
    if (input.frequency === "weekdays" && (day === 0 || day === 6)) continue;
    if (input.frequency === "weekly" && !(input.days ?? []).includes(day)) continue;
    if (at > after.getTime()) return new Date(at).toISOString();
  }
  throw new Error("No upcoming occurrence");
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<unknown> {
  req.setEncoding("utf8");
  let text = "";
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 1_000_000) throw new Error("Request too large");
  }
  return JSON.parse(text) as unknown;
}

/** Each preview server owns its disposable edits. Project and chat IDs come from the shared demo scenarios. */
export class PreviewAutomations {
  private readonly items = new Map<string, Automation>();
  private readonly runs: Run[] = [];
  private readonly simulate: (
    automation: Automation,
    runID: string,
  ) => { chatID: string; messageID: string } | null;

  constructor(simulate: PreviewAutomations["simulate"]) {
    this.simulate = simulate;
    const seeds = [
      {
        id: "accessibility",
        chatID: "focus",
        name: "Review keyboard accessibility",
        enabled: true,
        mode: "same" as const,
      },
      {
        id: "api-checks",
        chatID: "pagination",
        name: "Review API regressions",
        enabled: false,
        mode: "new" as const,
      },
      {
        id: "settings-review",
        chatID: "waiting",
        name: "Review project settings",
        enabled: true,
        mode: "same" as const,
      },
    ];
    for (const seed of seeds) {
      const chat = scenarios.find((scenario) => scenario.id === seed.chatID);
      if (!chat) throw new Error(`Missing demo chat ${seed.chatID}`);
      const frame = chat.frames.at(-1);
      if (!frame) throw new Error(`Missing demo history ${seed.chatID}`);
      const first = frame.history.find(({ info }) => info.role === "user");
      const instruction =
        first?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n") ?? "Review this project.";
      const item: Automation = {
        ...seed,
        chatID: seed.mode === "same" ? seed.chatID : "",
        projectID: chat.projectID,
        instructions: instruction,
        frequency: "weekly",
        days: [1],
        time: "09:00",
        timeZone: "America/New_York",
        revision: 1,
        nextRun: "",
      };
      item.nextRun = previewNextRun(item);
      this.items.set(item.id, item);
      // Only the original prompt is an automated run; later messages are ordinary follow-ups.
      if (first) {
        this.runs.push({
          id: `sample-${seed.id}`,
          automationID: item.id,
          chatID: chat.id,
          messageID: `saved-${first.info.id}`,
          scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
          status: frame.questions.length > 0 ? "waiting" : "completed",
          reason:
            frame.questions.length > 0
              ? "Flora needs your answer. This captured conversation is read-only."
              : "Sample run completed; follow-up messages are saved in the same chat.",
        });
      }
    }
  }
  forChat(chatID: string) {
    return this.runs.filter((run) => run.chatID === chatID);
  }
  private history(id: string) {
    return this.runs.filter((run) => run.automationID === id).toReversed();
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    const id = url.pathname.split("/")[3] ?? "";
    const action = url.pathname.split("/")[4] ?? "";
    if (id === "preview" && req.method === "POST") {
      const input = scheduleSchema.parse(await body(req));
      json(res, { nextRun: previewNextRun(input) });
      return;
    }
    if (!id && req.method === "GET") {
      json(
        res,
        [...this.items.values()].map((item) => ({ ...item, latestRun: this.history(item.id)[0] })),
      );
      return;
    }
    const existing = id ? this.items.get(id) : undefined;
    if (id && !existing) {
      json(res, { error: "Unknown preview automation." }, 404);
      return;
    }
    if (existing && !action && req.method === "GET") {
      json(res, { automation: existing, runs: this.history(existing.id) });
      return;
    }
    if ((!id && req.method === "POST") || (existing && !action && req.method === "PUT")) {
      const input = inputSchema.parse(await body(req));
      if (
        !projects.some((project) => project.id === input.projectID) ||
        (existing && existing.projectID !== input.projectID)
      ) {
        json(res, { error: "Choose a preview project." }, 400);
        return;
      }
      if (existing && existing.revision !== input.revision) {
        json(res, { error: "This automation changed. Reload before saving." }, 409);
        return;
      }
      const item: Automation = {
        ...input,
        id: existing?.id ?? randomUUID(),
        nextRun: previewNextRun(input),
        chatID: existing?.mode === input.mode ? existing.chatID : "",
        revision: (existing?.revision ?? 0) + 1,
      };
      this.items.set(item.id, item);
      json(res, item);
      return;
    }
    if (existing && action === "run" && req.method === "POST") {
      const { requestID } = z
        .object({ requestID: z.string().min(1).max(100) })
        .parse(await body(req));
      const duplicate = this.runs.find((run) => run.id === requestID);
      if (duplicate) {
        json(res, duplicate, duplicate.automationID === existing.id ? 202 : 409);
        return;
      }
      const result = this.simulate(existing, requestID);
      const run: Run = {
        id: requestID,
        automationID: existing.id,
        scheduledAt: new Date().toISOString(),
        status: result ? "completed" : "skipped",
        reason: result
          ? "Simulated preview run. No tools were executed or files changed."
          : "This chat is working or waiting for an answer.",
        chatID: result?.chatID ?? existing.chatID,
        messageID: result?.messageID ?? "",
      };
      if (result && existing.mode === "same") existing.chatID = result.chatID;
      this.runs.push(run);
      json(res, run, 202);
      return;
    }
    json(res, { error: "No preview fixture for this endpoint." }, 405);
  }
}
