import { lazy, Suspense, useEffect, useRef, useState } from "react";

import {
  Alert,
  Button,
  FlowerMark,
  CrossCircledIcon,
  Message as ChatMessage,
  MessageContent,
  Bubble,
  BubbleContent,
  Trace,
  TraceLine,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "@flora/florets";

import { AttachmentPreview } from "./attachment-preview";
import { type Message, type Part, toolDisplayInputSchema } from "./chat-schemas";
import { PullEventCard } from "./pull-links";
import type { Pull } from "./pull-schemas";
import { subagentSession } from "./subagent-state";
import { SubagentLink } from "./subagents";
import { formatDuration, isFailedPart, isLivePart, workTiming, type WorkStep } from "./transcript";

const Markdown = lazy(async () => {
  const { ReplyMarkdown } = await import("./reply-markdown");
  return { default: ReplyMarkdown };
});

function ReplyText({ children }: { children: string }) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
      <Markdown>{children}</Markdown>
    </Suspense>
  );
}

export function ConversationMessage({
  message: m,
  delegated = false,
  pullEvents,
}: {
  message: Message;
  delegated?: boolean;
  pullEvents?: { pull: Pull; opened: boolean }[] | undefined;
}) {
  const parts = m.Payload.parts.filter(
    (part) => part.type !== "step-start" && part.type !== "step-finish",
  );
  const failure = m.Payload.info?.error ?? null;
  const [copyStatus, setCopyStatus] = useState("Copy");
  const copyText =
    parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n\n") || m.Text;
  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Could not copy");
    }
  }

  return (
    <div className="group min-w-0">
      <ChatMessage align={m.Role === "user" ? "end" : "start"}>
        <MessageContent>
          <span className="sr-only">
            {m.Role === "user" ? (delegated ? "Parent agent" : "You") : "Flora"}
          </span>
          <Bubble variant={m.Role === "user" ? "muted" : "ghost"}>
            <BubbleContent className="space-y-4 text-sm leading-6">
              {parts.length > 0 ? (
                parts.map((part, index) => (
                  <MessagePart key={part.id ?? index} part={part} user={m.Role === "user"} />
                ))
              ) : (
                <MessagePart part={{ type: "text", text: m.Text }} user={m.Role === "user"} />
              )}
            </BubbleContent>
          </Bubble>
          {pullEvents?.map(({ pull, opened }) => (
            <PullEventCard key={pull.url} pull={pull} opened={opened} />
          ))}
          {failure !== null && (
            <Alert variant="destructive" role="alert">
              <pre className="text-sm break-words whitespace-pre-wrap">
                {JSON.stringify(failure, null, 2)}
              </pre>
            </Alert>
          )}
          {copyText !== "" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit text-xs text-muted-foreground md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
              onClick={() => {
                void copy();
              }}
              aria-label="Copy message"
            >
              <span role="status">{copyStatus}</span>
            </Button>
          )}
        </MessageContent>
      </ChatMessage>
    </div>
  );
}

export function WorkSummary({
  steps,
  active,
  failed,
}: {
  steps: WorkStep[];
  active: boolean;
  failed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => new Set());
  const root = useRef<HTMLDivElement>(null);
  function stepDetails(step: WorkStep) {
    return (
      <div key={step.id} data-step-id={step.id}>
        <MessagePart
          part={step.part}
          user={false}
          live={active}
          expanded={expandedSteps.has(step.id)}
          onExpandedChange={(expanded) => {
            setExpandedSteps((current) => {
              const next = new Set(current);
              if (expanded) next.add(step.id);
              else next.delete(step.id);
              return next;
            });
            if (expanded && active && !open) {
              setOpen(true);
              requestAnimationFrame(() => {
                root.current
                  ?.querySelector<HTMLButtonElement>(
                    `[data-step-id="${CSS.escape(step.id)}"] button`,
                  )
                  ?.focus();
              });
            }
          }}
        />
      </div>
    );
  }
  const timing = workTiming(steps, active);
  const now = useActivityClock(active && timing !== undefined);
  const failures = steps.filter((step) => isFailedPart(step.part)).length;
  const running = steps.filter((step) => isLivePart(step.part));
  const elapsed = timing
    ? formatDuration(Math.max(0, (timing.end ?? now) - timing.start))
    : undefined;
  let title = elapsed === undefined ? "Work details" : `Worked for ${elapsed}`;
  if (active) title = elapsed === undefined ? "Working" : `Working for ${elapsed}`;
  return (
    <div ref={root} data-slot="work-summary" className="space-y-2">
      <Trace>
        <TraceCollapsible open={open} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>
            <TraceLine status={failed ? "error" : undefined}>
              <TraceTitle>{title}</TraceTitle>
              <TraceDescription>
                {steps.length} {steps.length === 1 ? "step" : "steps"}
                {steps.some((step) => subagentSession(step.part) !== undefined) &&
                  " · Subagent activity"}
                {failures > 0 && (
                  <>
                    {" · "}
                    <span className="inline-flex items-center gap-1 text-destructive">
                      {failures} failed
                      <CrossCircledIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    </span>
                  </>
                )}
              </TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="space-y-3">
            {steps.map((step) => stepDetails(step))}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
      {active && !open && (
        <div aria-label="Current activity" className="space-y-2">
          {running.map((step) => stepDetails(step))}
          {running.length === 0 && (
            <FlowerMark className="text-muted-foreground motion-safe:animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}

function useActivityClock(ticking: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);
  return now;
}

function MessagePart({
  part: p,
  user,
  live = false,
  expanded,
  onExpandedChange,
}: {
  part: Part;
  user: boolean;
  live?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  if (p.type === "file" && user && p.url !== undefined) {
    const match = /^\/api\/attachments\/([a-zA-Z0-9-]+)\/content$/u.exec(p.url);
    if (match?.[1] !== undefined) {
      return (
        <AttachmentPreview
          file={{
            id: match[1],
            name: p.filename ?? "Attachment",
            mime: p.mime ?? "application/octet-stream",
            size: 0,
            projectID: "",
            createdAt: "",
          }}
          description="Open attachment"
        />
      );
    }
  }
  if (p.type === "text") {
    return user ? (
      <div className="whitespace-pre-wrap">{p.text}</div>
    ) : (
      <ReplyText>{p.text ?? ""}</ReplyText>
    );
  }
  if (p.type === "reasoning") {
    return (
      <Trace>
        <TraceCollapsible
          open={expanded ?? localOpen}
          onOpenChange={onExpandedChange ?? setLocalOpen}
        >
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceTitle>
                {live && p.time?.end === undefined ? "Thinking" : "Reasoning"}
              </TraceTitle>
              {(live || p.time?.end !== undefined) && (
                <ActivityDuration start={p.time?.start} end={p.time?.end} />
              )}
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="whitespace-pre-wrap">
            {p.text}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    );
  }
  if (p.type === "tool") {
    const output = p.state?.output ?? "";
    const error = p.state?.error ?? "";
    const status = p.state?.status;
    let description = status;
    if (!live && isLivePart(p)) description = "Incomplete";
    if (error !== "" || status === "error") description = "Failed";
    const delegationLabel =
      ({ completed: "Finished", error: "Failed" } as Record<string, string>)[status ?? ""] ??
      "Delegated to";
    let traceStatus: "error" | "running" | "pending" | undefined;
    if (error !== "" || status === "error") traceStatus = "error";
    else if (live && (status === "running" || status === "pending")) traceStatus = status;
    return (
      <Trace>
        {subagentSession(p) !== undefined && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{delegationLabel}</span>
            <SubagentLink part={p} />
          </div>
        )}
        <TraceCollapsible
          open={expanded ?? localOpen}
          onOpenChange={onExpandedChange ?? setLocalOpen}
        >
          <TraceCollapsibleTrigger>
            <TraceLine status={traceStatus}>
              <TraceTitle>{toolTitle(p)}</TraceTitle>
              <TraceDescription>{description}</TraceDescription>
              {(live || p.state?.time?.end !== undefined) && (
                <ActivityDuration start={p.state?.time?.start} end={p.state?.time?.end} />
              )}
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <pre className="overflow-auto text-xs break-words whitespace-pre-wrap">
              {JSON.stringify(p.state?.input, null, 2)}
            </pre>
            {output !== "" && (
              <pre className="mt-3 max-h-96 overflow-auto text-xs break-words whitespace-pre-wrap">
                {output}
              </pre>
            )}
            {error !== "" && (
              <pre role="alert" className="mt-3 text-xs break-words whitespace-pre-wrap">
                {error}
              </pre>
            )}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    );
  }
  return (
    <Trace>
      <TraceCollapsible
        open={expanded ?? localOpen}
        onOpenChange={onExpandedChange ?? setLocalOpen}
      >
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceTitle>{p.type}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <pre className="overflow-auto text-xs break-words whitespace-pre-wrap">
            {JSON.stringify(p, null, 2)}
          </pre>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function toolTitle(part: Part) {
  if (part.state?.title !== undefined && part.state.title !== "") return part.state.title;
  const names: Record<string, string> = {
    bash: "Running command",
    read: "Reading file",
    edit: "Editing file",
    write: "Writing file",
    grep: "Searching files",
    glob: "Finding files",
    question: "Waiting for your answer",
    webfetch: "Fetching page",
  };
  const input = toolDisplayInputSchema.parse(part.state?.input);
  if (input.description !== undefined && input.description !== "") return input.description;
  if (input.filePath !== undefined) {
    return `${names[part.tool ?? ""] ?? part.tool ?? "File"} ${input.filePath}`;
  }
  return names[part.tool ?? ""] ?? part.tool ?? "Tool";
}

/** Uses recorded runtime timestamps so reconnecting does not restart the elapsed time. */
function ActivityDuration({ start, end }: { start: number | undefined; end?: number | undefined }) {
  const now = useActivityClock(start !== undefined && end === undefined);
  if (start === undefined) return null;
  return <TraceDescription>{formatDuration(Math.max(0, (end ?? now) - start))}</TraceDescription>;
}
