import { useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "../components/button";
import { NativeSelect, Textarea } from "../components/input";
import { cn } from "../lib/utils";
import { TraceDisclosure, type DisclosureProps } from "./trace";

// Compositions follow https://ui.shadcn.com/docs/ai-elements; callbacks belong to the consuming app.
export function Bubble({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble"
      className={cn(
        "w-fit max-w-full rounded-xl bg-muted px-3 py-2 whitespace-pre-wrap break-words",
        className,
      )}
      {...props}
    />
  );
}
export function CodeBlock({
  children,
  title,
  className,
  ...props
}: Omit<ComponentProps<"pre">, "children" | "title"> & { children: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="my-2 min-w-0 rounded-lg bg-muted/50">
      <div className="flex items-center justify-between gap-2 px-3 py-1 text-xs text-muted-foreground">
        <span>{title}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void copy();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {error && (
        <p role="status" className="px-3 text-xs">
          Could not copy. Select the text to copy it.
        </p>
      )}
      <pre
        tabIndex={0}
        className={cn("max-h-96 overflow-auto px-3 pb-3 text-xs leading-6", className)}
        {...props}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}
export function ChainOfThought(props: DisclosureProps) {
  return <TraceDisclosure {...props} />;
}
export function Reasoning({
  title = "Thinking",
  ...props
}: Omit<DisclosureProps, "title"> & { title?: ReactNode }) {
  return <TraceDisclosure title={title} {...props} />;
}
export function Tool(props: DisclosureProps) {
  return <TraceDisclosure {...props} />;
}
export function Subagent(props: DisclosureProps) {
  return <TraceDisclosure {...props} />;
}
export function Plan(props: DisclosureProps) {
  return <TraceDisclosure {...props} />;
}
export function Queue(props: DisclosureProps) {
  return <TraceDisclosure {...props} />;
}
export function Checkpoint(props: ComponentProps<typeof Button>) {
  return <Button variant="outline" size="sm" {...props} />;
}
export function Suggestion(props: ComponentProps<typeof Button>) {
  return <Button variant="outline" className="rounded-full" {...props} />;
}
export function Task({
  status = "pending",
  children,
}: {
  status?: "pending" | "running" | "completed" | "error";
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1 text-sm">
      <span className="text-muted-foreground">
        {
          { pending: "Pending", running: "Running", completed: "Completed", error: "Failed" }[
            status
          ]
        }
      </span>
      <span>{children}</span>
    </div>
  );
}
export function Terminal({ command, output }: { command: string; output: string }) {
  return <CodeBlock title={command}>{output}</CodeBlock>;
}
export function StackTrace({ error, stack }: { error: string; stack: string }) {
  return (
    <TraceDisclosure title={error} status="error">
      <CodeBlock>{stack}</CodeBlock>
    </TraceDisclosure>
  );
}
export function Confirmation({
  children,
  onApprove,
  onReject,
  disabled = false,
}: {
  children: ReactNode;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>{children}</div>
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={onApprove}>
          Approve
        </Button>
        <Button variant="outline" disabled={disabled} onClick={onReject}>
          Reject
        </Button>
      </div>
    </div>
  );
}
export function Context({
  used,
  total,
  label = "Context",
}: {
  used: number;
  total: number;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <meter
        min={0}
        max={Math.max(total, 1)}
        value={Math.min(Math.max(used, 0), Math.max(total, 1))}
      />
      {used.toLocaleString()} / {total.toLocaleString()}
    </label>
  );
}
export type FileTreeEntry = { path: string; name: string; children?: FileTreeEntry[] };
export function FileTree({
  entries,
  onSelect,
}: {
  entries: FileTreeEntry[];
  onSelect?: (path: string) => void;
}) {
  return (
    <ul className="space-y-1 pl-3 text-sm">
      {entries.map((entry) => (
        <li key={entry.path}>
          {entry.children ? (
            <details>
              <summary className="cursor-pointer">{entry.name}</summary>
              <FileTree entries={entry.children} {...(onSelect ? { onSelect } : {})} />
            </details>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={!onSelect}
              onClick={() => {
                onSelect?.(entry.path);
              }}
            >
              {entry.name}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
export function InlineCitation({
  children,
  href,
  title,
}: {
  children: ReactNode;
  href: string;
  title?: string;
}) {
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
      className="rounded bg-muted px-1 text-xs underline underline-offset-2"
    >
      {children}
    </a>
  );
}
export function Sources({ sources }: { sources: { title: string; href: string }[] }) {
  return (
    <TraceDisclosure title={`Sources (${sources.length})`}>
      <ul className="space-y-2">
        {sources.map((source) => (
          <li key={source.href}>
            <a
              href={source.href}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline underline-offset-2"
            >
              {source.title}
            </a>
          </li>
        ))}
      </ul>
    </TraceDisclosure>
  );
}
export function ModelSelector({
  models,
  ...props
}: ComponentProps<typeof NativeSelect> & {
  models: { id: string; name: string; disabled?: boolean }[];
}) {
  return (
    <NativeSelect aria-label="Model" {...props}>
      {models.map((model) => (
        <option key={model.id} value={model.id} disabled={model.disabled}>
          {model.name}
        </option>
      ))}
    </NativeSelect>
  );
}
export function PromptInput({ className, ...props }: ComponentProps<"form">) {
  return (
    <form
      data-slot="prompt-input"
      className={cn("rounded-xl border border-border bg-muted/30 p-3", className)}
      {...props}
    />
  );
}
export function PromptInputTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn("min-h-12 resize-none border-0 bg-transparent", className)}
      {...props}
    />
  );
}
export function PromptInputActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("mt-2 flex items-center justify-between gap-2", className)} {...props} />
  );
}
export function TestResults({
  results,
}: {
  results: { name: string; status: "passed" | "failed" | "skipped"; output?: string }[];
}) {
  const failed = results.filter((result) => result.status === "failed").length;
  return (
    <TraceDisclosure
      title={`${results.length} tests · ${failed} failed`}
      status={failed > 0 ? "error" : undefined}
    >
      <ul className="space-y-2">
        {results.map((result) => (
          <li key={result.name}>
            <TraceDisclosure
              title={result.name}
              description={result.status}
              status={result.status === "failed" ? "error" : undefined}
            >
              {result.output !== undefined && result.output !== "" ? (
                <CodeBlock>{result.output}</CodeBlock>
              ) : (
                <p className="text-xs text-muted-foreground">No output.</p>
              )}
            </TraceDisclosure>
          </li>
        ))}
      </ul>
    </TraceDisclosure>
  );
}
export { Input as PromptInputField } from "../components/input";
