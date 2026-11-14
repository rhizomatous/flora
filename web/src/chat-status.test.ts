import { describe, expect, it } from "vitest";

import { chatStatus } from "./chat-status";

describe("chat status presentation", () => {
  it.each([
    ["working", "Preparing checkout and setup", "working", "Working"],
    ["working", "Flora is working", "working", "Working"],
    ["waiting", "Waiting for the model provider to retry", "working", "Working"],
    ["waiting", "Flora needs your answer", "waiting", "Needs you"],
    ["waiting", "Question reply delivery is uncertain", "waiting", "Needs you"],
    ["idle", "Turn completed; ready for a follow-up", "idle", "Idle"],
    ["failed", "Runtime failed", "failed", "Failed"],
    ["stopped", "Container stopped", "stopped", "Stopped"],
  ] as const)(
    "presents %s / %s consistently before and after reading",
    (...[Status, StatusReason, id, label]) => {
      for (const seen of [false, true]) {
        expect(chatStatus({ Status, StatusReason }, seen)).toMatchObject({
          id,
          label,
          pulse: id === "working",
        });
      }
    },
  );
  it("clears the unread marker without changing the completed status", () => {
    const chat = { Status: "idle", StatusReason: "Turn completed" } as const;
    expect(chatStatus(chat)).toMatchObject({ label: "Idle", filled: true });
    expect(chatStatus(chat, true)).toMatchObject({ label: "Idle", filled: false });
  });
});
