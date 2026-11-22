import { expect, test } from "vitest";

import { latestOrganization, pinnedChats } from "./chat-organization";
import { chatSchema } from "./chat-schemas";

function chat(id: string, pin = "") {
  return chatSchema.parse({
    ID: id,
    PublicID: "FLORA-1",
    Title: id,
    ProjectID: "project",
    Status: "idle",
    StatusReason: "Done",
    UpdatedAt: "2026-11-16T10:00:00Z",
    ImageDigest: "",
    HarnessVersion: "",
    StartingCommits: {},
    PinnedAt: pin,
    Archived: false,
    OrganizationRevision: 0,
  });
}

test("late runtime snapshots retain renamed metadata while delivering current execution state", () => {
  const old = chat("one");
  const renamed = {
    ...old,
    Title: "Useful name",
    FolderID: "release",
    Archived: true,
    OrganizationRevision: 2,
  };
  const running = { ...old, Status: "working" as const, UpdatedAt: "2026-11-16T11:00:00Z" };
  expect(latestOrganization(running, renamed)).toEqual({
    ...running,
    Title: renamed.Title,
    Archived: true,
    FolderID: "release",
    OrganizationRevision: 2,
  });
  expect(latestOrganization(renamed, running)).toEqual(renamed);
});

test("pins sort newest first with stable identity ties and exclude archived chats", () => {
  const older = chat("older", "2026-11-16T10:00:00.1Z");
  const newer = chat("newer", "2026-11-16T10:00:00.11Z");
  const tie = chat("a", newer.PinnedAt);
  const archived = { ...chat("archived", "2026-11-16T11:00:00Z"), Archived: true };
  expect(pinnedChats([older, newer, chat("unpinned"), archived, tie]).map((row) => row.ID)).toEqual(
    ["a", "newer", "older"],
  );
});
