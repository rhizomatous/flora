import { z } from "zod";

import type { Part } from "./chat-schemas";

const todosSchema = z.array(
  z.object({
    content: z.string().min(1),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  }),
);
const todoInputSchema = z.object({ todos: todosSchema });
export type Todo = z.infer<typeof todosSchema>[number];

/** Reads saved todo snapshots from successful runtime calls. Failed or partial writes never replace the current list. */
export function readTodos(part: Part): Todo[] | undefined {
  if (
    part.type !== "tool" ||
    (part.tool !== "todowrite" && part.tool !== "todoread") ||
    part.state?.status !== "completed" ||
    (part.state.error ?? "") !== ""
  ) {
    return;
  }
  const outputText = part.state.output ?? "";
  if (outputText !== "") {
    try {
      const output: unknown = JSON.parse(outputText);
      const result = todosSchema.safeParse(output);
      if (result.success) return result.data;
    } catch {
      // Some runtimes return a text acknowledgement; a successful write still has its saved input.
    }
  }
  if (part.tool !== "todowrite") return;
  const input = todoInputSchema.safeParse(part.state.input);
  return input.success ? input.data.todos : undefined;
}

export function hasUnfinishedTodos(todos: Todo[]) {
  return todos.some((todo) => todo.status === "pending" || todo.status === "in_progress");
}
