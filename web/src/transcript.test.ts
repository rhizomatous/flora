import assert from "node:assert/strict";

import { test } from "vitest";

import type { Message, Part } from "./chat-schemas.ts";
import { buildTranscript, workTiming, formatDuration } from "./transcript.ts";

function message(id: string, parts: Part[], role = "assistant"): Message {
  return { ID: id, Role: role, Text: "", Provider: "", Model: "", Payload: { parts } };
}
function tool(id: string, [start, end]: [number, number], status = "completed"): Part {
  return { id, type: "tool", tool: "bash", state: { status, time: { start, end } } };
}
const user = message("user", [{ type: "text", text: "Please fix it" }], "user");

test("work spans runtime messages and ignores empty text and internal step markers", () => {
  const rows = buildTranscript(
    [
      user,
      message("a", [tool("read", [0, 500], "error")]),
      message("b", [
        { type: "step-start" },
        { type: "text", text: "  " },
        tool("check", [500, 2500]),
        { type: "step-finish" },
      ]),
      message("c", [{ type: "text", text: "Finished." }]),
    ],
    "idle",
  );
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["message", "work", "message"],
  );
  const group = rows[1];
  assert.ok(group?.kind === "work");
  assert.equal(group.steps.length, 2);
  assert.equal(group.failed, false);
  assert.deepEqual(workTiming(group.steps, false), { start: 0, end: 2500 });
});

test("visible updates and user replies split groups, including within a single runtime message", () => {
  const rows = buildTranscript(
    [
      user,
      message("a", [
        tool("one", [0, 1000]),
        { type: "text", text: "Checking another file." },
        tool("two", [1000, 2000]),
      ]),
      message("user2", [{ type: "text", text: "Try again" }], "user"),
      message("b", [tool("three", [2000, 3000])]),
    ],
    "working",
  );
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["message", "work", "message", "work", "message", "work"],
  );
  assert.deepEqual(
    rows.filter((row) => row.kind === "work").map((row) => row.active),
    [false, false, true],
  );
});

test("group identity survives appended steps and completion so disclosure state can survive streaming", () => {
  const first = message("a", [
    { id: "one", type: "tool", state: { status: "running", time: { start: 0 } } },
  ]);
  const before = buildTranscript([user, first], "working");
  const after = buildTranscript(
    [
      user,
      message("a", [tool("one", [0, 1000])]),
      message("b", [tool("two", [500, 2000])]),
      message("c", [{ type: "text", text: "Done" }]),
    ],
    "idle",
  );
  assert.equal(before[1]?.id, after[1]?.id);
  assert.equal(before[1]?.kind === "work" && before[1].active, true);
  assert.equal(after[1]?.kind === "work" && after[1].active, false);
});

test("failures are emphasized only when the current turn has an explicit failed status", () => {
  const messages = [
    user,
    message("a", [tool("one", [0, 1000], "error")]),
    message("user2", [{ type: "text", text: "Retry" }], "user"),
    message("b", [tool("two", [1000, 2000], "error")]),
  ];
  for (const status of ["working", "idle", "stopped"]) {
    assert.equal(
      buildTranscript(messages, status).some((row) => row.kind === "work" && row.failed),
      false,
    );
  }
  assert.deepEqual(
    buildTranscript(messages, "failed")
      .filter((row) => row.kind === "work")
      .map((row) => row.failed),
    [false, true],
  );
});

test("message-level errors stay visible and preserve their order", () => {
  const failed = message("a", [tool("one", [0, 1000])]);
  failed.Payload.info = { error: { message: "Provider disconnected" } };
  const rows = buildTranscript([user, failed, message("b", [tool("two", [1000, 2000])])], "failed");
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["message", "work", "message", "work"],
  );
  assert.ok(rows[2]?.kind === "message");
  assert.deepEqual(rows[2].message.Payload.info?.error, { message: "Provider disconnected" });
});

test("timing uses elapsed wall time for parallel work and refuses incomplete or invalid timing", () => {
  const steps = [tool("a", [0, 3000]), tool("b", [1000, 4000])].map((part) => ({
    id: part.id ?? "",
    part,
  }));
  assert.deepEqual(workTiming(steps, false), { start: 0, end: 4000 });
  assert.deepEqual(workTiming(steps, true), { start: 0, end: undefined });
  assert.equal(workTiming([...steps, { id: "unknown", part: { type: "tool" } }], false), undefined);
  assert.equal(
    workTiming(
      [{ id: "running", part: { type: "tool", state: { status: "running", time: { start: 0 } } } }],
      false,
    ),
    undefined,
  );
  assert.equal(workTiming([{ id: "invalid", part: tool("bad", [2000, 1000]) }], false), undefined);
  assert.equal(formatDuration(10), "less than 1s");
  assert.equal(formatDuration(140_000), "2m 20s");
});

test("text-only saved messages, reasoning, unknown parts, and empty assistant messages remain safe", () => {
  const text = message("text", []);
  text.Text = "Saved response";
  const rows = buildTranscript(
    [
      user,
      message("empty", [{ type: "text", text: "" }]),
      text,
      message("work", [
        { id: "r", type: "reasoning", text: "Inspecting", time: { start: 1, end: 2 } },
        { id: "attachment", type: "file" },
      ]),
    ],
    "idle",
  );
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["message", "message", "work"],
  );
  assert.ok(rows[1]?.kind === "message");
  assert.equal(rows[1].message.Payload.parts[0]?.text, "Saved response");
  assert.ok(rows[2]?.kind === "work");
  assert.equal(rows[2].steps.length, 2);
  assert.equal(workTiming(rows[2].steps, false), undefined);
});

test("a parallel action remains live across a visible update until its runtime status finishes", () => {
  const running = message("a", [
    { id: "job", type: "tool", state: { status: "running", time: { start: 1000 } } },
  ]);
  const update = message("b", [{ type: "text", text: "The checks are still running." }]);
  const rows = buildTranscript([user, running, update], "working");
  assert.ok(rows[1]?.kind === "work");
  assert.equal(rows[1].active, true);
  const stopped = buildTranscript([user, running, update], "stopped");
  assert.ok(stopped[1]?.kind === "work");
  assert.equal(stopped[1].active, false);
  assert.equal(workTiming(stopped[1].steps, false), undefined);
});
