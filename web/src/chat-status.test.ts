import { describe, expect, it } from "vitest";

import { chatSchema } from "./chat-schemas";
import { chatStatus } from "./chat-status";
import { isChatSeen, latestRead } from "./sidebar-status";

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
  it("keeps failed and waiting attention filled after reading", () => {
    for (const Status of ["failed", "waiting"] as const) {
      expect(chatStatus({ Status, StatusReason: "Needs attention" }, true).filled).toBe(true);
    }
  });
  it("clears the unread marker without changing the completed status", () => {
    const chat = { Status: "idle", StatusReason: "Turn completed" } as const;
    expect(chatStatus(chat)).toMatchObject({ label: "Idle", filled: true });
    expect(chatStatus(chat, true)).toMatchObject({ label: "Idle", filled: false });
  });
});

it("retains acknowledged positions in stale feeds while newer activity remains unread", () => {
  const chat = chatSchema.parse({
    ID: "one",
    PublicID: "FLOR-1",
    ProjectID: "project",
    Title: "Chat",
    Status: "idle",
    StatusReason: "Done",
    UpdatedAt: "2026-11-18T00:00:00Z",
    ImageDigest: "",
    HarnessVersion: "",
    StartingCommits: {},
    ActivityRevision: 10,
    LastViewedRevision: 5,
  });
  const read = { ...chat, LastViewedRevision: 10 };
  expect(isChatSeen(latestRead(chat, read))).toBe(true);
  const newer = latestRead({ ...chat, ActivityRevision: 11 }, read);
  expect(newer.LastViewedRevision).toBe(10);
  expect(isChatSeen(newer)).toBe(false);
});
