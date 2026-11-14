import assert from "node:assert/strict";

import { test } from "vitest";

import { captured } from "../../scripts/preview/captured.ts";
import { messages } from "../../scripts/preview/server.ts";
import { chatChangesSchema } from "./changes-schemas.ts";
import {
  activitySchema,
  chatSchema,
  toolDisplayInputSchema,
  messageSchema,
  questionSchema,
  requestIdentitySchema,
} from "./chat-schemas.ts";

const message = {
  ID: "one",
  Role: "assistant",
  Text: "hello",
  Provider: "",
  Model: "",
  Payload: {},
};

test("all captured OpenCode messages and questions parse", () => {
  for (const story of captured) {
    for (const frame of story.frames) {
      for (const saved of messages(frame, "fixture")) messageSchema.parse(saved);
      for (const question of frame.questions) questionSchema.parse(question);
    }
  }
});

test("user and older messages get an empty parts array; malformed parts are rejected", () => {
  assert.deepEqual(messageSchema.parse(message).Payload.parts, []);
  for (const parts of [
    null,
    {},
    [{ type: "text", text: 123 }],
    [{ type: "tool", state: { status: "running", time: { start: "now" } } }],
  ]) {
    assert.equal(messageSchema.safeParse({ ...message, Payload: { parts } }).success, false);
  }
});

test("new runtime part types and opaque tool data survive parsing", () => {
  const parts = [
    { type: "future-part", metadata: { value: 1 } },
    { type: "tool", state: { status: "running", input: { arbitrary: [1, 2] } } },
  ];
  assert.deepEqual(messageSchema.parse({ ...message, Payload: { parts } }).Payload.parts, parts);
});

test("question defaults preserve single-choice and custom-answer behavior", () => {
  const parsed = questionSchema.parse({
    id: "q",
    questions: [{ question: "Which?", header: "Choice", options: [] }],
  });
  assert.equal(parsed.questions[0]?.multiple, false);
  assert.equal(parsed.questions[0].custom, true);
});

test("Go's null pull list is normalized without hiding malformed lists", () => {
  const review = {
    snapshot: null,
    stale: false,
    error: "",
    pulls: { items: null, error: "", checkedAt: "" },
  };
  assert.deepEqual(chatChangesSchema.parse(review).pulls.items, []);
  assert.equal(
    chatChangesSchema.safeParse({ ...review, pulls: { ...review.pulls, items: {} } }).success,
    false,
  );
});

test("activity parsing requires the chat identity used to display capture gaps", () => {
  const event = { ChatID: "chat", Kind: "capture.gap", Sequence: 1 };
  assert.deepEqual(activitySchema.parse(event), event);
  assert.equal(activitySchema.safeParse({ Kind: "capture.gap", Sequence: 1 }).success, false);
  assert.equal(activitySchema.safeParse({ ...event, Sequence: 1.5 }).success, false);
});

test("saved retry identities require both the original body and a string ID", () => {
  assert.equal(requestIdentitySchema.safeParse({ body: "{}", id: "retry" }).success, true);
  for (const saved of [null, {}, { body: "{}", id: 1 }, { body: {}, id: "retry" }]) {
    assert.equal(requestIdentitySchema.safeParse(saved).success, false);
  }
});

test("display hints do not constrain arbitrary tool inputs", () => {
  assert.deepEqual(toolDisplayInputSchema.parse(null), {});
  assert.deepEqual(toolDisplayInputSchema.parse(["input"]), {});
  assert.deepEqual(
    toolDisplayInputSchema.parse({ description: 123, filePath: "src/main.ts", other: true }),
    { description: undefined, filePath: "src/main.ts" },
  );
});

test("chat parsing preserves linked pull-request metadata and normalizes empty summaries", () => {
  const pull = {
    url: "https://github.com/example/app/pull/1",
    number: 1,
    state: "merged",
    draft: false,
    title: "Fix chat",
    additions: 0,
    deletions: 2,
  };
  const chat = {
    ID: "chat",
    ProjectID: "project",
    Title: "Chat",
    Status: "idle",
    StatusReason: "",
    UpdatedAt: "",
    ImageDigest: "",
    HarnessVersion: "",
    StartingCommits: {},
    pulls: { items: [pull], checkedAt: "today", error: "" },
  };
  assert.deepEqual(chatSchema.parse(chat).pulls?.items, [pull]);
  assert.equal(
    chatSchema.parse({ ...chat, pulls: { ...chat.pulls, items: [{ ...pull, state: "" }] } }).pulls
      ?.items[0]?.state,
    "",
  );
  assert.deepEqual(
    chatSchema.parse({ ...chat, pulls: { ...chat.pulls, items: null } }).pulls?.items,
    [],
  );
  assert.equal(
    chatSchema.safeParse({
      ...chat,
      pulls: { ...chat.pulls, items: [{ ...pull, additions: "zero" }] },
    }).success,
    false,
  );
});
