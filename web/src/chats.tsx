// oxlint-disable import/max-dependencies -- The chat view imports its feature controls and boundary schemas directly.
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  Alert,
  ArrowDownIcon,
  Button,
  ButtonLink,
  FlowerMark,
  Heading,
  CrossCircledIcon,
  Text,
  Message as ChatMessage,
  MessageContent,
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
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

import { authenticatedSchema } from "./auth-schemas";
import {
  ChatTurnNavigation,
  ChatPullProvider,
  ChatTitle,
  ChatHeaderActions,
  ChatComposerFooter,
  ChatReviewStrip,
} from "./chat-controls";
import { ChatList } from "./chat-list";
import {
  type Chat,
  type Question,
  activitySchema,
  toolDisplayInputSchema,
  requestIdentitySchema,
  detailSchema,
  questionSchema,
  chatSchema,
  acceptanceSchema,
  type Activity,
  type Detail,
  type Message,
  type Part,
} from "./chat-schemas";
import { chatStatus } from "./chat-status";
import { Composer } from "./composer";
import { NewChatComposer } from "./new-chat-composer";
import { projectSummarySchema, type ProjectSummary } from "./project-schemas";
import { QuestionForm } from "./question";
import { errorMessage, isExpired, request } from "./request";
import {
  buildTranscript,
  formatDuration,
  isFailedPart,
  isLivePart,
  workTiming,
  type WorkStep,
} from "./transcript";
import { text } from "./ui";

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

const requestKey = (scope: string) => `flora-request:${scope}`;

// Keep the accepted identity across ambiguous responses and page reloads.
// A changed input is a new request, never an edit to an accepted turn.
function identity(scope: string, input: unknown) {
  const key = requestKey(scope);
  const body = JSON.stringify(input);
  try {
    const saved = requestIdentitySchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? "null"),
    );
    if (saved.success && saved.data.body === body) return saved.data.id;
  } catch {
    /* Invalid or unavailable session storage does not prevent sending. */
  }
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(key, JSON.stringify({ body, id }));
  } catch {
    /* Private browsing can disable storage. */
  }
  return id;
}

function forgetIdentity(scope: string) {
  try {
    sessionStorage.removeItem(requestKey(scope));
  } catch {
    /* Storage may be disabled. */
  }
}

export function Chats({
  path,
  messageBytes,
  onExpired,
  list,
  listError,
}: {
  path: string;
  messageBytes: number;
  onExpired: () => void;
  list: Chat[] | undefined;
  listError: string;
}) {
  // Undefined until the project list loads.
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [detail, setDetail] = useState<Detail>();
  const [activity, setActivity] = useState<Activity[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionError, setQuestionError] = useState("");
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = path.startsWith("chats/") ? path.slice(6) : "";
  const isNew = id === "new" || id.startsWith("new?");
  const projectID = new URLSearchParams(path.split("?")[1]).get("project") ?? "";
  const [selectedProjectID, setSelectedProjectID] = useState(projectID);
  const selectedProject =
    projects?.find((project) => project.id === selectedProjectID) ?? projects?.[0];
  const chatPath = `chats/${encodeURIComponent(id)}`;

  function report(e: unknown) {
    setError(errorMessage(e, "Could not load chat."));
    if (isExpired(e)) onExpired();
  }
  const fail = useEffectEvent(report);
  const expire = useEffectEvent(onExpired);

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    const load = async () => {
      try {
        const rows = await request(projectSummarySchema.array(), "projects");
        if (active) setProjects(rows);
      } catch (e) {
        if (active) fail(e);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (id === "" || isNew) return;
    let active = true;
    const base = `chats/${encodeURIComponent(id)}`;

    // One detail load runs at a time. Refreshes requested meanwhile collapse into one more
    // load, so the final state reflects every event seen so far.
    let loading = false;
    let dirty = false;
    const refresh = async () => {
      dirty = true;
      if (loading) return;
      loading = true;
      try {
        while (dirty) {
          dirty = false;
          // oxlint-disable-next-line no-await-in-loop -- Loads must run one after another so a stale response never overwrites a newer one.
          const next = await request(detailSchema, base);
          if (!active) return;
          setDetail(next);
        }
      } catch (e) {
        if (active) fail(e);
      } finally {
        loading = false;
      }
    };
    void refresh();

    const source = new EventSource(`/api/${base}/events`);
    // EventSource reconnects on its own. A failure may mean the session ended, in which case
    // retrying is pointless.
    const checkSession = async () => {
      try {
        const status = await request(authenticatedSchema, "auth/status");
        if (active && !status.authenticated) {
          source.close();
          expire();
        }
      } catch {
        /* The check is advisory. The EventSource keeps retrying. */
      }
    };
    // A burst of activity triggers one detail refresh 100 ms after its first event.
    let debounce: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("open", () => {
      setDisconnected(false);
    });
    source.addEventListener("error", () => {
      setDisconnected(true);
      void checkSession();
    });
    source.addEventListener("activity", (event: MessageEvent<string>) => {
      let row: Activity;
      try {
        row = activitySchema.parse(JSON.parse(event.data));
      } catch {
        setError("Could not read saved activity. Reload to reconnect.");
        return;
      }
      setActivity((rows) =>
        rows.some((r) => r.Sequence === row.Sequence) ? rows : [...rows, row],
      );
      debounce ??= setTimeout(() => {
        debounce = undefined;
        void refresh();
      }, 100);
    });

    const pollQuestions = async () => {
      try {
        const rows = await request(questionSchema.array(), `${base}/questions`);
        if (!active) return;
        setQuestions(rows);
        setQuestionError("");
      } catch (e) {
        if (!active) return;
        setQuestions([]);
        setQuestionError("Live questions unavailable. Saved questions may no longer be pending.");
        if (isExpired(e)) expire();
      }
    };
    void pollQuestions();
    const timer = setInterval(() => {
      void pollQuestions();
    }, 1000);

    return () => {
      active = false;
      source.close();
      clearInterval(timer);
      clearTimeout(debounce);
    };
  }, [id, isNew]);

  async function send(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const message = text(fields, "text");
    if (message.trim() === "" || new TextEncoder().encode(message).length > messageBytes) {
      setError(`Enter a message of at most ${messageBytes.toLocaleString()} UTF-8 bytes.`);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    const project = text(fields, "project");
    // Forty-five Unicode code points fit within the server's 200-byte title limit.
    const chatTitle =
      // oxlint-disable-next-line typescript/no-misused-spread -- Bound code points to stay below the UTF-8 byte limit without splitting surrogate pairs.
      [...message.trim().replaceAll(/\s+/gu, " ")].slice(0, 45).join("");
    const input = isNew ? { title: chatTitle, text: message } : { text: message };
    const scope = isNew ? `project:${project}` : `chat:${id}`;
    try {
      const requestID = identity(scope, input);
      if (isNew) {
        const chat = await request(chatSchema, `projects/${encodeURIComponent(project)}/chats`, {
          method: "POST",
          body: {
            ...input,
            requestID,
          },
        });
        window.location.hash = `chats/${chat.ID}`;
      } else {
        await request(acceptanceSchema, `${chatPath}/messages`, {
          method: "POST",
          body: {
            text: message,
            requestID,
          },
        });
        form.reset();
        saveDraft(id, "");
        setDetail(await request(detailSchema, chatPath));
      }
      forgetIdentity(scope);
    } catch (e) {
      report(e);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function controlWork(action: "interrupt" | "stop") {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await request(chatSchema, `${chatPath}/${action}`, { method: "POST", body: {} });
      setQuestions([]);
    } catch (e) {
      report(e);
    }
    // Show the outcome whether or not the action succeeded.
    try {
      setDetail(await request(detailSchema, chatPath));
    } catch (e) {
      report(e);
    }
    submitting.current = false;
    setBusy(false);
  }

  if (id === "") return <ChatList list={list} projects={projects} error={error || listError} />;

  const pulls = list?.find((chat) => chat.ID === id)?.pulls ?? detail?.chat.pulls;
  const existingChat = !isNew && id !== "";
  const headerLayout = existingChat
    ? "florets-topbar chat-header [&_h1]:flex-[0_1_auto] max-[560px]:gap-0.5 max-[560px]:[&_h1]:flex-1 max-[560px]:[&>[aria-disabled=true]]:hidden -mx-4 flex shrink-0 items-center gap-1 border-b px-3 sm:-mx-8"
    : "mx-auto flex w-full max-w-[880px] shrink-0 items-center justify-between gap-4 pb-3";
  const chatLayout = id === "" ? "mx-auto max-w-4xl min-w-0" : "flex min-h-0 flex-1 flex-col";

  function title() {
    if (isNew) return "New chat";
    if (id === "") return "Chats";
    const saved = detail?.chat.Title ?? "";
    return saved === "" ? "Chat" : saved;
  }

  return (
    <section
      aria-labelledby="chats-heading"
      className={isNew ? "mx-auto my-12 w-full max-w-[720px] md:mt-[25svh]" : chatLayout}
    >
      <div className={isNew ? "sr-only" : headerLayout}>
        {existingChat && <span className="sidebar-toggle-space" aria-hidden="true" />}
        <Heading
          level={1}
          id="chats-heading"
          aria-label={title()}
          ref={heading}
          tabIndex={-1}
          className="min-w-0 truncate text-base"
        >
          {existingChat ? <ChatTitle title={title()} chat={detail?.chat} pulls={pulls} /> : title()}
        </Heading>
        {existingChat && <ChatHeaderActions />}
      </div>
      {error !== "" && (
        <Alert role="alert" className="mt-6">
          {error}
        </Alert>
      )}
      {isNew && projects === undefined && error === "" && (
        <Text role="status">Loading projects…</Text>
      )}
      {isNew && projects?.length === 0 && (
        <div className="space-y-5">
          <Heading level={2}>Connect your first project</Heading>
          <Text tone="muted">Choose a GitHub repository so Flora can start working.</Text>
          <ButtonLink href="#projects/new">Connect a project</ButtonLink>
        </div>
      )}
      {isNew && projects !== undefined && projects.length > 0 && (
        <NewChatComposer
          projects={projects}
          selectedProject={selectedProject}
          onProjectChange={setSelectedProjectID}
          busy={busy}
          onSend={(event) => {
            void send(event);
          }}
        />
      )}
      {id !== "" && !isNew && detail === undefined && error === "" && (
        <Text size="md" role="status" className="mt-8">
          Loading…
        </Text>
      )}
      {detail && (
        <ChatDetail
          pulls={pulls}
          id={id}
          detail={detail}
          activity={activity}
          disconnected={disconnected}
          busy={busy}
          onControl={(action) => {
            void controlWork(action);
          }}
          onSend={(event) => {
            void send(event);
          }}
        >
          {questionError !== "" && (
            <Text className="mt-6" role="status">
              {questionError}
            </Text>
          )}
          {questions.map((q) => (
            <QuestionForm
              key={q.id}
              question={q}
              chatID={id}
              onError={report}
              onAnswered={() => {
                setQuestions((rows) => rows.filter((row) => row.id !== q.id));
              }}
            />
          ))}
        </ChatDetail>
      )}
    </section>
  );
}

/** Keeps pending questions above the composer while the transcript scrolls independently. */
function ChatDetail({
  pulls,
  id,
  detail,
  activity,
  disconnected,
  busy,
  onControl,
  onSend,
  children,
}: {
  id: string;
  detail: Detail;
  pulls: Chat["pulls"];
  activity: Activity[];
  disconnected: boolean;
  busy: boolean;
  onControl: (action: "interrupt" | "stop") => void;
  onSend: (event: React.SubmitEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const { chat } = detail;
  const activeTurn = chat.Status === "working" || chat.Status === "waiting";
  const stopped = chat.Status === "stopped";
  const blocked = detail.continuationBlockedReason !== "";
  const rows = buildTranscript(detail.messages, chat.Status);
  const visibleActivity = rows.some((row) => row.kind === "work" && row.active);

  return (
    <ChatPullProvider value={pulls}>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="-mx-4 w-auto flex-1 sm:-mx-8">
          <MessageScrollerViewport aria-label="Conversation" className="chat-transcript-viewport">
            <MessageScrollerContent className="mx-auto w-full max-w-[900px] gap-6 px-4 py-6">
              {disconnected && <Alert role="status">Disconnected. Reconnecting…</Alert>}
              {activity.some((row) => row.ChatID === id && row.Kind === "capture.gap") && (
                <Alert role="note">
                  Some live activity could not be captured. Recovered messages and tool snapshots
                  are shown; transient output may be missing.
                </Alert>
              )}
              {rows.map((row) => (
                <MessageScrollerItem
                  key={row.id}
                  messageId={row.id}
                  scrollAnchor={row.kind === "message" && row.message.Role === "user"}
                >
                  {row.kind === "work" ? (
                    <WorkSummary steps={row.steps} active={row.active} failed={row.failed} />
                  ) : (
                    <ConversationMessage message={row.message} />
                  )}
                </MessageScrollerItem>
              ))}
              {activeTurn && !visibleActivity && (
                <div role="status" aria-label={chatStatus(chat).label} title={chat.StatusReason}>
                  <FlowerMark
                    className={
                      chatStatus(chat).pulse
                        ? "text-muted-foreground motion-safe:animate-pulse"
                        : "text-muted-foreground"
                    }
                  />
                </div>
              )}
              {(chat.Status === "failed" ||
                chat.Status === "stopped" ||
                chat.StatusReason.includes("interrupted")) &&
                chat.StatusReason !== "" && <Text role="status">{chat.StatusReason}</Text>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <ChatTurnNavigation rows={rows} />
        </MessageScroller>
        <div className="chat-composer-dock mx-auto max-h-[70dvh] w-full max-w-[900px] shrink-0 overflow-y-auto pt-2 pb-[env(safe-area-inset-bottom)]">
          <div className="chat-pending-questions max-h-[50dvh] overflow-y-auto empty:hidden [&_form]:mt-0 [&_form]:mb-3">
            {children}
          </div>
          <ChatReviewStrip key={`review-${id}`} pulls={pulls}>
            <MessageScrollerButton
              aria-label="Jump to latest"
              size="sm"
              className="composer-accessory chat-scroll-latest h-7 gap-1.5 border border-border px-2.5 text-xs [&_svg]:size-[13px]!"
            >
              <ArrowDownIcon />
              Scroll to end
            </MessageScrollerButton>
          </ChatReviewStrip>
          <FollowUpComposer
            key={id}
            id={id}
            busy={busy}
            activeTurn={activeTurn}
            blocked={blocked}
            stopped={stopped}
            onSend={onSend}
            onControl={onControl}
          />
        </div>
      </MessageScrollerProvider>
    </ChatPullProvider>
  );
}

function saveDraft(id: string, value: string) {
  try {
    sessionStorage.setItem(`flora-draft:${id}`, value);
  } catch {
    /* Drafting still works when browser storage is unavailable. */
  }
}

function readDraft(id: string) {
  try {
    return sessionStorage.getItem(`flora-draft:${id}`) ?? "";
  } catch {
    return "";
  }
}

function FollowUpComposer({
  id,
  busy,
  activeTurn,
  blocked,
  stopped,
  onSend,
  onControl,
}: {
  id: string;
  busy: boolean;
  activeTurn: boolean;
  blocked: boolean;
  stopped: boolean;
  onSend: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onControl: (action: "interrupt" | "stop") => void;
}) {
  const [draft, setDraft] = useState(() => readDraft(id));
  const sendLabel = stopped ? "Resume" : "Send message";
  const canSend = !busy && !activeTurn && !blocked && draft.trim() !== "";

  return (
    <form
      className="chat-composer follow-up-composer"
      onSubmit={(event) => {
        if (!canSend) {
          event.preventDefault();
          return;
        }
        onSend(event);
      }}
      onReset={() => {
        setDraft("");
      }}
    >
      <Composer
        id="follow-up-message"
        label="Follow-up"
        message={draft}
        onChange={(value) => {
          setDraft(value);
          saveDraft(id, value);
        }}
        disabled={busy || blocked}
        canSend={canSend}
        sendLabel={blocked ? "Continuation unavailable" : sendLabel}
        onInterrupt={
          activeTurn && !blocked
            ? () => {
                onControl("interrupt");
              }
            : undefined
        }
      />
      <ChatComposerFooter busy={busy} blocked={blocked} stopped={stopped} onControl={onControl} />
    </form>
  );
}

function ConversationMessage({ message: m }: { message: Message }) {
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
          <span className="sr-only">{m.Role === "user" ? "You" : "Flora"}</span>
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

function WorkSummary({
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
    let traceStatus: "error" | "running" | "pending" | undefined;
    if (error !== "" || status === "error") traceStatus = "error";
    else if (live && (status === "running" || status === "pending")) traceStatus = status;
    return (
      <Trace>
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
