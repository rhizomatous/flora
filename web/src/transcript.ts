import type { Part, Message } from "./schemas.ts";

export type { Part, Message } from "./schemas.ts";

export type WorkStep = { id: string; part: Part };
export type TranscriptRow =
  | { kind: "message"; id: string; message: Message }
  | { kind: "work"; id: string; steps: WorkStep[]; active: boolean; failed: boolean };

export function isLivePart(part: Part) {
  return (
    part.state?.status === "running" ||
    part.state?.status === "pending" ||
    (part.type === "reasoning" && part.time?.end === undefined)
  );
}

export function isFailedPart(part: Part) {
  return part.state?.status === "error" || (part.state?.error ?? "") !== "";
}

/** Groups saved work across runtime messages. Only visible prose, user messages, and message errors end a group. */
export function buildTranscript(messages: Message[], status: string): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let work: Extract<TranscriptRow, { kind: "work" }> | undefined;
  let turnStart = 0;
  for (const message of messages) {
    if (message.Role === "user") {
      work = undefined;
      rows.push({ kind: "message", id: message.ID, message });
      turnStart = rows.length;
      continue;
    }
    let prose: Extract<TranscriptRow, { kind: "message" }> | undefined;
    const savedParts = message.Payload.parts;
    const parts = savedParts.length > 0 ? savedParts : [{ type: "text", text: message.Text }];
    for (const [index, part] of parts.entries()) {
      if (part.type === "step-start" || part.type === "step-finish") continue;
      const id = `${message.ID}:${part.id ?? index}`;
      if (part.type === "text") {
        if ((part.text ?? "").trim() === "") continue;
        work = undefined;
        if (prose) {
          prose.message.Payload.parts.push(part);
        } else {
          prose = {
            kind: "message",
            id: `text:${id}`,
            message: { ...message, Text: "", Payload: { parts: [part] } },
          };
          rows.push(prose);
        }
      } else {
        prose = undefined;
        if (!work) {
          work = { kind: "work", id: `work:${id}`, steps: [], active: false, failed: false };
          rows.push(work);
        }
        work.steps.push({ id, part });
      }
    }
    if (message.Payload.info?.error !== undefined && message.Payload.info.error !== null) {
      work = undefined;
      rows.push({
        kind: "message",
        id: `error:${message.ID}`,
        message: { ...message, Text: "", Payload: { parts: [], info: message.Payload.info } },
      });
    }
  }
  const last = rows.at(-1);
  if (status === "working" || status === "waiting") {
    for (const row of rows.slice(turnStart)) {
      if (row.kind === "work") {
        row.active = row === last || row.steps.some((step) => isLivePart(step.part));
      }
    }
  }
  // A failed tool alone does not prove that the turn failed or that another tool recovered it.
  if (status === "failed") {
    const lastWork = rows.slice(turnStart).findLast((row) => row.kind === "work");
    if (lastWork?.kind === "work") {
      lastWork.failed = lastWork.steps.some((step) => isFailedPart(step.part));
    }
  }
  return rows;
}

/** Returns wall-clock bounds only when every step has usable timing; missing data never becomes a zero-second duration. */
export function workTiming(steps: WorkStep[], active: boolean) {
  const times = steps.map(({ part }) => part.state?.time ?? part.time);
  if (
    times.length === 0 ||
    times.some((time) => time === undefined || !Number.isFinite(time.start))
  ) {
    return;
  }
  const starts: number[] = [];
  const ends: number[] = [];
  for (const time of times) {
    if (!time) return;
    starts.push(time.start);
    if (time.end === undefined) {
      if (!active) return;
    } else {
      if (!Number.isFinite(time.end) || time.end < time.start) return;
      ends.push(time.end);
    }
  }
  return { start: Math.min(...starts), end: active ? undefined : Math.max(...ends) };
}

export function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return "less than 1s";
  const seconds = Math.floor(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
