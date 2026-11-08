import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  Alert,
  Button,
  ButtonLink,
  FieldLabel,
  FlowerMark,
  Heading,
  Link,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  ChevronDownIcon,
  Text,
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
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
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@flora/florets";

import { Changes } from "./changes";
import type { Chat } from "./notifications";
import { QuestionForm, type Question } from "./question";
import { errorMessage, isExpired, request } from "./request";
import { text } from "./ui";

type Part = {
  id?: string;
  type: string;
  text?: string;
  tool?: string;
  time?: { start: number; end?: number };
  state?: {
    time?: { start: number; end?: number };
    status: string;
    input?: unknown;
    output?: string;
    error?: string;
    title?: string;
  };
};
type Message = {
  ID: string;
  Role: string;
  Text: string;
  Provider: string;
  Model: string;
  Payload: { parts?: Part[]; info?: { error?: unknown } };
};
type Activity = {
  ChatID: string;
  Sequence: number;
  Kind: string;
  CreatedAt: string;
  Payload: unknown;
};
type Detail = { chat: Chat; messages: Message[]; continuationBlockedReason?: string };
type Project = { id: string; name: string };

const Markdown = lazy(async () => {
  const { Markdown: Component } = await import("@flora/florets/ai");
  return { default: Component };
});

function ReplyText({ children }: { children: string }) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
      <Markdown>{children}</Markdown>
    </Suspense>
  );
}

const statusName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Checks the fields the activity log depends on: Sequence deduplicates rows and Kind labels them.
const isActivity = (value: unknown): value is Activity =>
  typeof value === "object" &&
  value !== null &&
  "Sequence" in value &&
  typeof value.Sequence === "number" &&
  "Kind" in value &&
  typeof value.Kind === "string";

const requestKey = (scope: string) => `flora-request:${scope}`;

// Keep the accepted identity across ambiguous responses and page reloads.
// A changed input is a new request, never an edit to an accepted turn.
function identity(scope: string, input: unknown) {
  const key = requestKey(scope);
  const body = JSON.stringify(input);
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      typeof saved === "object" &&
      saved !== null &&
      "body" in saved &&
      saved.body === body &&
      "id" in saved &&
      typeof saved.id === "string"
    ) {
      return saved.id;
    }
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
  onExpired,
  messageBytes,
  list,
  listError,
}: {
  path: string;
  onExpired: () => void;
  messageBytes: number;
  list: Chat[] | undefined;
  listError: string;
}) {
  // Undefined until the project list loads.
  const [projects, setProjects] = useState<Project[]>();
  const [detail, setDetail] = useState<Detail>();
  const [activity, setActivity] = useState<Activity[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionError, setQuestionError] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Connecting…");
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
        const rows = await request<Project[]>("projects");
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
          const next = await request<Detail>(base);
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
        const status = await request<{ authenticated: boolean }>("auth/status");
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
      setConnection("Live");
    });
    source.addEventListener("error", () => {
      setConnection("Disconnected. Reconnecting to saved activity…");
      void checkSession();
    });
    source.addEventListener("activity", (event: MessageEvent<string>) => {
      let row: unknown;
      try {
        row = JSON.parse(event.data);
      } catch {
        /* Reported below. */
      }
      if (!isActivity(row)) {
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
        const rows = await request<Question[]>(`${base}/questions`);
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
        const chat = await request<Chat>(`projects/${encodeURIComponent(project)}/chats`, "POST", {
          ...input,
          requestID,
        });
        window.location.hash = `chats/${chat.ID}`;
      } else {
        await request(`${chatPath}/messages`, "POST", { text: message, requestID });
        form.reset();
        saveDraft(id, "");
        setDetail(await request<Detail>(chatPath));
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
      await request(`${chatPath}/${action}`, "POST", {});
      setQuestions([]);
    } catch (e) {
      report(e);
    }
    // Show the outcome whether or not the action succeeded.
    try {
      setDetail(await request<Detail>(chatPath));
    } catch (e) {
      report(e);
    }
    submitting.current = false;
    setBusy(false);
  }

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
      className={isNew ? "mx-auto my-12 max-w-3xl md:mt-[25svh]" : chatLayout}
    >
      <div
        className={
          isNew
            ? "sr-only"
            : "mx-auto flex w-full max-w-[880px] shrink-0 items-center justify-between gap-4 pb-3"
        }
      >
        <Heading
          level={1}
          id="chats-heading"
          ref={heading}
          tabIndex={-1}
          className="min-w-0 text-base break-words"
        >
          {title()}
        </Heading>
      </div>
      {error !== "" && (
        <Alert role="alert" className="mt-6">
          {error}
        </Alert>
      )}
      {id === "" && list !== undefined && <ChatList list={list} projects={projects ?? []} />}
      {id === "" && list === undefined && error === "" && listError === "" && (
        <Text size="md" role="status" className="mt-8">
          Loading…
        </Text>
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
        <form
          onSubmit={(event) => {
            void send(event);
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="project" value={selectedProject?.id ?? ""} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-label={`Project: ${selectedProject?.name ?? ""}`}
                >
                  {selectedProject?.name}
                  <ChevronDownIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={selectedProject?.id ?? ""}
                  onValueChange={setSelectedProjectID}
                  aria-label="Project"
                >
                  {projects.map((project) => (
                    <DropdownMenuRadioItem key={project.id} value={project.id}>
                      {project.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <InputGroup>
            <FieldLabel className="sr-only" htmlFor="new-chat-message">
              Message
            </FieldLabel>
            <InputGroupTextarea
              id="new-chat-message"
              name="text"
              className="max-h-80 min-h-28"
              placeholder="What are we building?"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!busy) event.currentTarget.form?.requestSubmit();
                }
              }}
              required
              disabled={busy}
            />
            <InputGroupAddon align="block-end" className="justify-end">
              <InputGroupButton type="submit" variant="default" size="sm" disabled={busy}>
                {busy ? "Starting…" : "Start chat"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      )}
      {id !== "" && !isNew && detail === undefined && error === "" && (
        <Text size="md" role="status" className="mt-8">
          Loading…
        </Text>
      )}
      {detail && (
        <ChatDetail
          id={id}
          detail={detail}
          activity={activity}
          connection={connection}
          projectName={projects?.find((p) => p.id === detail.chat.ProjectID)?.name}
          busy={busy}
          messageBytes={messageBytes}
          onExpired={onExpired}
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

/** Lists chats grouped under their projects, in project order. */
function ChatList({ list, projects }: { list: Chat[]; projects: Project[] }) {
  if (list.length === 0) {
    return (
      <Text tone="muted" className="mt-8">
        No chats yet. Start a chat in a connected project.
      </Text>
    );
  }
  return (
    <div className="mt-8 space-y-8">
      {projects.map((p) => {
        const chats = list.filter((c) => c.ProjectID === p.id);
        return (
          chats.length > 0 && (
            <section key={p.id} aria-labelledby={`project-${p.id}`}>
              <Heading level={2} id={`project-${p.id}`}>
                <Link href={`#projects/${p.id}`}>{p.name}</Link>
              </Heading>
              <ul className="mt-3 space-y-2">
                {chats.map((c) => (
                  <li key={c.ID}>
                    <Item variant="outline">
                      <ItemContent>
                        <ItemTitle>
                          <Link href={`#chats/${c.ID}`} className="font-medium break-words">
                            {c.Title}
                          </Link>
                        </ItemTitle>
                        <ItemDescription>
                          {statusName(c.Status)} ·{" "}
                          <time dateTime={c.UpdatedAt}>
                            {new Date(c.UpdatedAt).toLocaleString()}
                          </time>
                        </ItemDescription>
                        {c.StatusReason !== "" && (
                          <ItemDescription>{c.StatusReason}</ItemDescription>
                        )}
                      </ItemContent>
                    </Item>
                  </li>
                ))}
              </ul>
            </section>
          )
        );
      })}
    </div>
  );
}

/** Keeps pending questions above the composer while the transcript scrolls independently. */
function ChatDetail({
  id,
  detail,
  activity,
  connection,
  projectName,
  busy,
  messageBytes,
  onExpired,
  onControl,
  onSend,
  children,
}: {
  id: string;
  detail: Detail;
  activity: Activity[];
  connection: string;
  projectName: string | undefined;
  busy: boolean;
  messageBytes: number;
  onExpired: () => void;
  onControl: (action: "interrupt" | "stop") => void;
  onSend: (event: React.SubmitEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const { chat } = detail;
  const activeTurn = chat.Status === "working" || chat.Status === "waiting";
  const stopped = chat.Status === "stopped";
  const blocked = (detail.continuationBlockedReason ?? "") !== "";

  const model = detail.messages.findLast((message) => message.Model !== "");

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent className="mx-auto w-full max-w-[880px] gap-8 px-1 py-6">
            {activity.some((row) => row.ChatID === id && row.Kind === "capture.gap") && (
              <Alert role="note">
                Some live activity could not be captured. Recovered messages and tool snapshots are
                shown; transient output may be missing.
              </Alert>
            )}
            {detail.messages.map((message) => (
              <MessageScrollerItem
                key={message.ID}
                messageId={message.ID}
                scrollAnchor={message.Role === "user"}
              >
                <ConversationMessage message={message} />
              </MessageScrollerItem>
            ))}
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              {activeTurn && <FlowerMark className="motion-safe:animate-pulse" />}
              <span>
                {statusName(chat.Status)}
                {chat.StatusReason !== "" && ` · ${chat.StatusReason}`}
              </span>
            </div>
            <Changes key={id} chatID={id} onExpired={onExpired} />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="Jump to latest" />
      </MessageScroller>
      <div className="mx-auto max-h-[70dvh] w-full max-w-[880px] shrink-0 overflow-y-auto bg-background pt-3 pb-[env(safe-area-inset-bottom)]">
        <div className="max-h-[30dvh] overflow-y-auto empty:hidden [&_form]:mt-0 [&_form]:mb-3">
          {children}
        </div>
        <FollowUpComposer
          key={id}
          id={id}
          busy={busy}
          activeTurn={activeTurn}
          blocked={blocked}
          stopped={stopped}
          messageBytes={messageBytes}
          onSend={onSend}
          onControl={onControl}
        />
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-ring">
            {projectName} · {connection} · Environment & details
          </summary>
          <div className="max-h-[30dvh] overflow-y-auto pb-3">
            {model && (
              <p className="py-2">
                {model.Provider}/{model.Model}
              </p>
            )}
            {!blocked && !stopped && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onControl("stop");
                }}
              >
                Stop container
              </Button>
            )}
            <p className="mt-2">
              {stopped
                ? "Send a message to restart with the saved workspace and conversation."
                : "Stopping frees container capacity and preserves your workspace and conversation."}
            </p>
            <Collapsible className="mt-3 rounded-md border p-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  Full activity ({activity.length} saved events)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Text tone="muted" className="mt-3">
                  Setup activity contains bounded previews. After setup finishes,{" "}
                  <Link href={`/api/chats/${encodeURIComponent(id)}/setup-log`}>
                    download the full redacted setup log
                  </Link>
                  . Any capture failure is shown in the final setup event.
                </Text>
                <ol className="mt-4 space-y-3">
                  {activity.map((row) => (
                    <li key={row.Sequence}>
                      <Trace>
                        <TraceCollapsible>
                          <TraceCollapsibleTrigger>
                            <TraceLine>
                              <TraceTitle>{row.Kind}</TraceTitle>
                              <TraceDescription>
                                <time dateTime={row.CreatedAt}>
                                  {new Date(row.CreatedAt).toLocaleTimeString()}
                                </time>{" "}
                                · #{row.Sequence}
                              </TraceDescription>
                            </TraceLine>
                          </TraceCollapsibleTrigger>
                          <TraceCollapsibleContent>
                            <pre className="max-h-96 overflow-auto text-xs break-words whitespace-pre-wrap">
                              {JSON.stringify(row.Payload, null, 2)}
                            </pre>
                          </TraceCollapsibleContent>
                        </TraceCollapsible>
                      </Trace>
                    </li>
                  ))}
                </ol>
              </CollapsibleContent>
            </Collapsible>
            <Collapsible className="mt-3 rounded-md border p-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  Environment snapshot
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-3 overflow-auto text-xs break-all whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      image: chat.ImageDigest,
                      OpenCode: chat.HarnessVersion,
                      startingCommits: chat.StartingCommits,
                    },
                    null,
                    2,
                  )}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </details>
      </div>
    </MessageScrollerProvider>
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
  messageBytes,
  onSend,
  onControl,
}: {
  id: string;
  busy: boolean;
  activeTurn: boolean;
  blocked: boolean;
  stopped: boolean;
  messageBytes: number;
  onSend: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onControl: (action: "interrupt" | "stop") => void;
}) {
  const [draft, setDraft] = useState(() => readDraft(id));
  const sendLabel = stopped ? "Resume" : "Send message";
  const canSend = !busy && !activeTurn && !blocked && draft.trim() !== "";
  let help = "Enter to send · Shift+Enter for a new line";
  if (stopped) help = "Your next message resumes this workspace.";
  if (activeTurn) help = "Draft your next message while Flora works.";
  if (blocked) help = "Continuation unavailable. Saved work is retained.";

  return (
    <form
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
      <FieldLabel htmlFor="follow-up-message" className="sr-only">
        Follow-up
      </FieldLabel>
      <InputGroup>
        <InputGroupTextarea
          id="follow-up-message"
          name="text"
          className="max-h-[25dvh] min-h-20"
          placeholder="Ask Flora…"
          value={draft}
          required
          disabled={busy || blocked}
          aria-describedby="followup-help"
          onChange={(event) => {
            setDraft(event.target.value);
            saveDraft(id, event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          <span className="text-xs text-muted-foreground" id="followup-help">
            {help}
          </span>
          {activeTurn && !blocked ? (
            <InputGroupButton
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onControl("interrupt");
              }}
              title="Interrupt work and keep the container running"
            >
              Interrupt
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              disabled={!canSend}
              title={`Up to ${messageBytes.toLocaleString()} UTF-8 bytes`}
            >
              {blocked ? "Continuation unavailable" : sendLabel}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function ConversationMessage({ message: m }: { message: Message }) {
  const parts = (m.Payload.parts ?? []).filter(
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
            <BubbleContent className="space-y-4 text-[15px] leading-7">
              {parts.length > 0 ? (
                <MessageParts parts={parts} user={m.Role === "user"} />
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

function MessageParts({ parts, user }: { parts: Part[]; user: boolean }) {
  const groups: Part[][] = [];
  for (const part of parts) {
    const previous = groups.at(-1);
    if (part.type !== "text" && previous && previous[0]?.type !== "text") previous.push(part);
    else groups.push([part]);
  }
  return groups.map((group, index) => {
    const first = group[0];
    if (!first) return null;
    if (first.type === "text" || user) {
      return group.map((part, i) => <MessagePart key={part.id ?? i} part={part} user={user} />);
    }
    return <WorkSummary key={first.id ?? index} parts={group} />;
  });
}

function WorkSummary({ parts }: { parts: Part[] }) {
  const failed = parts.filter(
    (part) => part.state?.status === "error" || (part.state?.error ?? "") !== "",
  ).length;
  const running = parts.find(
    (part) => part.state?.status === "running" || part.state?.status === "pending",
  );
  const times = parts.flatMap((part) => {
    const time = part.state?.time ?? part.time;
    return time ? [time] : [];
  });
  const finished = times.length > 0 && times.every((time) => time.end !== undefined);
  const starts = times.map((time) => time.start);
  const ends = times.map((time) => time.end ?? time.start);
  const elapsed = Math.max(...ends) - Math.min(...starts);
  const seconds = finished ? Math.max(0, Math.round(elapsed / 1000)) : 0;
  const traceStatus = running ? "running" : undefined;
  const finishedLabel = finished
    ? `Worked for ${seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}`
    : "Work details";
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={failed > 0 ? "error" : traceStatus}>
            <TraceTitle>
              {running
                ? `Working · ${running.state?.title ?? running.tool ?? "Thinking"}`
                : finishedLabel}
            </TraceTitle>
            <TraceDescription>
              {parts.length} {parts.length === 1 ? "step" : "steps"}
              {failed > 0 && ` · ${failed} failed`}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-3">
          {parts.map((part, index) => (
            <MessagePart key={part.id ?? index} part={part} user={false} />
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function MessagePart({ part: p, user }: { part: Part; user: boolean }) {
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
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceTitle>Reasoning</TraceTitle>
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
    let traceStatus: "error" | "running" | "pending" | undefined;
    if (error !== "" || status === "error") traceStatus = "error";
    else if (status === "running" || status === "pending") traceStatus = status;
    return (
      <Trace>
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine status={traceStatus}>
              <TraceTitle>{p.state?.title ?? p.tool}</TraceTitle>
              <TraceDescription>
                {p.tool} · {status}
              </TraceDescription>
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
      <TraceCollapsible>
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
