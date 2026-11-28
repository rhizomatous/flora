import type { ReactNode } from "react";

import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CircleSlashIcon,
  Text,
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "@flora/florets";

import type { Todo } from "./todos";

const statuses = {
  pending: { icon: CircleIcon, label: "Pending" },
  in_progress: { icon: CircleDotIcon, label: "In progress" },
  completed: { icon: CircleCheckIcon, label: "Completed" },
  cancelled: { icon: CircleSlashIcon, label: "Cancelled" },
};

export function TodoChecklist({
  todos,
  open,
  onOpenChange,
  children,
}: {
  todos: Todo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const cancelled = todos.filter((todo) => todo.status === "cancelled").length;
  return (
    <Trace data-slot="todo-checklist">
      <TraceCollapsible open={open} onOpenChange={onOpenChange}>
        <TraceCollapsibleTrigger>
          <TraceLine className="flex-wrap gap-y-0">
            <TraceTitle className="font-medium text-foreground">
              {todos.length === 0 ? "No todos" : "Todos"}
            </TraceTitle>
            {todos.length > 0 && (
              <TraceDescription className="text-muted-foreground">
                {completed} of {todos.length} done
                {cancelled > 0 && ` · ${cancelled} cancelled`}
              </TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-3">
          {todos.length > 0 && (
            <ul aria-label="Todos" className="space-y-3">
              {todos.map((todo, index) => {
                const { icon: Icon, label } = statuses[todo.status];
                return (
                  // oxlint-disable-next-line react/no-array-index-key -- Runtime todo snapshots have no IDs and can contain repeated descriptions.
                  <li key={`${index}:${todo.content}`} className="flex min-w-0 items-start gap-2.5">
                    <Icon
                      aria-hidden="true"
                      className={`mt-1 size-4 shrink-0 ${todo.status === "in_progress" ? "text-foreground" : "text-muted-foreground"}`}
                    />
                    <div className="min-w-0">
                      <Text
                        tone={todo.status === "in_progress" ? "default" : "muted"}
                        className="wrap-anywhere"
                      >
                        <span className="sr-only">{label}: </span>
                        {todo.content}
                      </Text>
                      {(todo.status === "in_progress" || todo.status === "cancelled") && (
                        <Text size="xs" tone="muted" aria-hidden="true">
                          {label}
                        </Text>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceTitle>Details</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
          </TraceCollapsible>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
