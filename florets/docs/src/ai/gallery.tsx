// oxlint-disable import/max-dependencies -- The gallery includes every upstream pattern.
import { useState } from "react";

import { ChainOfThoughtDemo } from "./examples/chain-of-thought-demo";
import { ChatDemo } from "./examples/chat-demo";
import { CheckpointDemo } from "./examples/checkpoint-demo";
import { ConfirmationDemo } from "./examples/confirmation-demo";
import { ContextDemo } from "./examples/context-demo";
import { FileTreeDemo } from "./examples/file-tree-demo";
import { InlineCitationDemo } from "./examples/inline-citation-demo";
import { MessageDemo } from "./examples/message-demo";
import { ModelSelectorDemo } from "./examples/model-selector-demo";
import { PlanDemo } from "./examples/plan-demo";
import { PromptInputDemo } from "./examples/prompt-input-demo";
import { QueueDemo } from "./examples/queue-demo";
import { ReasoningDemo } from "./examples/reasoning-demo";
import { SourcesDemo } from "./examples/sources-demo";
import { StackTraceDemo } from "./examples/stack-trace-demo";
import { SubagentDemo } from "./examples/subagent-demo";
import { SuggestionDemo } from "./examples/suggestion-demo";
import { TaskDemo } from "./examples/task-demo";
import { TerminalDemo } from "./examples/terminal-demo";
import { TestResultsDemo } from "./examples/test-results-demo";
import { ToolDemo } from "./examples/tool-demo";

const patterns = [
  { id: "chain-of-thought", name: "Chain Of Thought", Component: ChainOfThoughtDemo },
  { id: "chat", name: "Chat", Component: ChatDemo },
  { id: "checkpoint", name: "Checkpoint", Component: CheckpointDemo },
  { id: "confirmation", name: "Confirmation", Component: ConfirmationDemo },
  { id: "context", name: "Context", Component: ContextDemo },
  { id: "file-tree", name: "File Tree", Component: FileTreeDemo },
  { id: "inline-citation", name: "Inline Citation", Component: InlineCitationDemo },
  { id: "message", name: "Message", Component: MessageDemo },
  { id: "model-selector", name: "Model Selector", Component: ModelSelectorDemo },
  { id: "plan", name: "Plan", Component: PlanDemo },
  { id: "prompt-input", name: "Prompt Input", Component: PromptInputDemo },
  { id: "queue", name: "Queue", Component: QueueDemo },
  { id: "reasoning", name: "Reasoning", Component: ReasoningDemo },
  { id: "sources", name: "Sources", Component: SourcesDemo },
  { id: "stack-trace", name: "Stack Trace", Component: StackTraceDemo },
  { id: "subagent", name: "Subagent", Component: SubagentDemo },
  { id: "suggestion", name: "Suggestion", Component: SuggestionDemo },
  { id: "task", name: "Task", Component: TaskDemo },
  { id: "terminal", name: "Terminal", Component: TerminalDemo },
  { id: "test-results", name: "Test Results", Component: TestResultsDemo },
  { id: "tool", name: "Tool", Component: ToolDemo },
];
export function AIGallery() {
  const [selected, setSelected] = useState(location.hash.slice(1) || "chain-of-thought");
  const [dark, setDark] = useState(true);
  const pattern = patterns.find((item) => item.id === selected) ?? patterns[0];
  const { Component } = pattern;
  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <a href="./index.html" className="text-sm underline">
          Florets
        </a>
        <h1 className="text-xl font-medium">AI Elements</h1>
        <button
          type="button"
          className="rounded-md border px-3 py-1 text-sm"
          onClick={() => {
            document.documentElement.classList.toggle("dark", !dark);
            setDark(!dark);
          }}
        >
          {dark ? "Light theme" : "Dark theme"}
        </button>
      </header>
      <label className="flex items-center gap-3 text-sm">
        Pattern
        <select
          aria-label="Pattern"
          value={selected}
          className="rounded-md border bg-background p-2"
          onChange={(event) => {
            setSelected(event.target.value);
            location.hash = event.target.value;
          }}
        >
          {patterns.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <p className="my-4 text-sm text-muted-foreground">
        Original shadcn Radix / Rhea examples. Import components from <code>@flora/florets/ai</code>{" "}
        and styles from <code>@flora/florets/ai/styles.css</code>.
      </p>
      <a
        className="text-sm underline"
        href={`https://ui.shadcn.com/docs/ai-elements/radix/${pattern.id}`}
      >
        Upstream example
      </a>
      <section
        aria-label={pattern.name}
        className="mt-8 flex min-h-80 items-center justify-center rounded-xl border p-6"
        key={pattern.id}
      >
        <Component />
      </section>
    </main>
  );
}
