import assert from "node:assert/strict";

import { test } from "vitest";

import type { Part } from "./chat-schemas";
import { hasUnfinishedTodos, readTodos } from "./todos";

const todos = [
  { content: "Inspect the project", status: "in_progress", priority: "high" },
  { content: "Run checks", status: "pending", priority: "medium" },
];
function write(state: NonNullable<Part["state"]>): Part {
  return { type: "tool", tool: "todowrite", state };
}

test("successful todo writes use the returned snapshot once, with input as an acknowledgement fallback", () => {
  const expected = todos.map(({ content, status }) => ({ content, status }));
  for (const output of [JSON.stringify(todos), "Updated the todo list.", ""]) {
    assert.deepEqual(readTodos(write({ status: "completed", input: { todos }, output })), expected);
  }
  assert.deepEqual(readTodos(write({ status: "completed", input: { todos }, output: "[]" })), []);
  assert.deepEqual(
    readTodos({
      type: "tool",
      tool: "todoread",
      state: { status: "completed", output: JSON.stringify(todos) },
    }),
    expected,
  );
});

test("failed, partial, unrelated, and malformed calls stay in the ordinary tool renderer", () => {
  for (const status of ["pending", "running", "error"]) {
    assert.equal(readTodos(write({ status, input: { todos } })), undefined);
  }
  assert.equal(
    readTodos(write({ status: "completed", input: { todos }, error: "Not saved" })),
    undefined,
  );
  for (const input of [
    null,
    {},
    { todos: "invalid" },
    { todos: [...todos, { content: "Unknown", status: "unknown" }] },
  ]) {
    assert.equal(readTodos(write({ status: "completed", input })), undefined);
  }
  assert.equal(
    readTodos({ type: "tool", tool: "other", state: { status: "completed", input: { todos } } }),
    undefined,
  );
  assert.equal(
    readTodos({
      type: "tool",
      tool: "todoread",
      state: { status: "completed", output: "not JSON" },
    }),
    undefined,
  );
});

test("cancelled todos retain their status without keeping a finished list expanded", () => {
  const items = readTodos(
    write({
      status: "completed",
      input: {
        todos: [
          { content: "Check the project", status: "completed" },
          { content: "Deploy", status: "cancelled" },
        ],
      },
    }),
  );
  assert.ok(items);
  assert.equal(items[1]?.status, "cancelled");
  assert.equal(hasUnfinishedTodos(items), false);
  assert.equal(hasUnfinishedTodos([]), false);
  assert.equal(hasUnfinishedTodos([...items, { content: "Review", status: "pending" }]), true);
  assert.equal(hasUnfinishedTodos([{ content: "Review", status: "in_progress" }]), true);
});
