import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  Alert,
  Button,
  FieldLabel,
  FlowerMark,
  Input,
  Link,
  NativeSelect,
  PageTitle,
  Textarea,
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
  state?: { status: string; input?: unknown; output?: string; error?: string; title?: string };
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
    const input = isNew ? { title: text(fields, "title"), text: message } : { text: message };
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

  function title() {
    if (isNew) return "New chat";
    if (id === "") return "Chats";
    const saved = detail?.chat.Title ?? "";
    return saved === "" ? "Chat" : saved;
  }

  return (
    <section aria-labelledby="chats-heading" className="min-w-0">
      <div className="flex items-center justify-between gap-4">
        <PageTitle id="chats-heading" ref={heading} tabIndex={-1} className="min-w-0 break-words">
          {title()}
        </PageTitle>
        <Link className="shrink-0 text-sm" href={id === "" ? "#chats/new" : "#chats"}>
          {id === "" ? "New chat" : "All chats"}
        </Link>
      </div>
      {error !== "" && (
        <Alert role="alert" className="mt-6">
          {error}
        </Alert>
      )}
      {id === "" && list !== undefined && <ChatList list={list} projects={projects ?? []} />}
      {id === "" && list === undefined && error === "" && listError === "" && (
        <p role="status" className="mt-8">
          Loading…
        </p>
      )}
      {isNew && (
        <form
          onSubmit={(event) => {
            void send(event);
          }}
          className="mt-8 space-y-6"
        >
          <FieldLabel>
            Project
            <NativeSelect
              name="project"
              className="mt-2"
              defaultValue={projectID}
              required
              disabled={busy}
            >
              <option value="">Choose a project</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </FieldLabel>
          {projects === undefined && error === "" && (
            <p role="status" className="text-sm">
              Loading projects…
            </p>
          )}
          {projects?.length === 0 && (
            <p className="text-sm">
              <Link href="#projects/new">Connect a project</Link> before starting a chat.
            </p>
          )}
          <FieldLabel>
            Chat title
            <Input name="title" className="mt-2" required maxLength={200} disabled={busy} />
          </FieldLabel>
          <FieldLabel>
            Message
            <Textarea
              name="text"
              className="mt-2 min-h-40"
              required
              disabled={busy}
              aria-describedby="message-limit"
            />
          </FieldLabel>
          <p id="message-limit" className="text-sm text-muted-foreground">
            Up to {messageBytes.toLocaleString()} UTF-8 bytes. Checkout and setup run before Flora
            starts work.
          </p>
          <Button type="submit" disabled={busy || projects === undefined || projects.length === 0}>
            {busy ? "Starting…" : "Start chat"}
          </Button>
        </form>
      )}
      {id !== "" && !isNew && detail === undefined && error === "" && (
        <p role="status" className="mt-8">
          Loading…
        </p>
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
            <p className="mt-6 text-sm" role="status">
              {questionError}
            </p>
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
      <p className="mt-8 text-sm text-muted-foreground">
        No chats yet. Start a chat in a connected project.
      </p>
    );
  }
  return (
    <div className="mt-8 space-y-8">
      {projects.map((p) => {
        const chats = list.filter((c) => c.ProjectID === p.id);
        return (
          chats.length > 0 && (
            <section key={p.id} aria-labelledby={`project-${p.id}`}>
              <h2 id={`project-${p.id}`} className="font-semibold">
                <Link href={`#projects/${p.id}`}>{p.name}</Link>
              </h2>
              <ul className="mt-3 divide-y divide-foreground/20">
                {chats.map((c) => (
                  <li key={c.ID} className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <Link href={`#chats/${c.ID}`} className="font-medium break-words">
                        {c.Title}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {statusName(c.Status)} ·{" "}
                        <time dateTime={c.UpdatedAt}>{new Date(c.UpdatedAt).toLocaleString()}</time>
                      </p>
                    </div>
                    <span className="max-w-md text-sm text-muted-foreground">{c.StatusReason}</span>
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

/** Shows one chat. `children` renders between the review of changes and the follow-up form. */
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

  function followUpHelp() {
    if (blocked) {
      return "Continuation is unavailable. Saved conversation and workspace files are retained.";
    }
    if (activeTurn) {
      return "Wait for the current turn to finish or answer Flora’s question. Messages are not queued.";
    }
    return `Continue in the same workspace and conversation. Up to ${messageBytes.toLocaleString()} UTF-8 bytes.`;
  }

  function sendLabel() {
    if (blocked) return "Continuation unavailable";
    if (busy) return "Working…";
    return stopped ? "Resume with new message" : "Send message";
  }

  return (
    <>
      <div
        role="status"
        className="mt-6 flex flex-wrap items-center gap-2 rounded-md border border-foreground/20 p-3 text-sm"
      >
        {chat.Status === "working" && <FlowerMark />}
        <strong>{statusName(chat.Status)}</strong>
        <span>{chat.StatusReason}</span>
      </div>
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {connection} · {projectName}
      </p>
      {activity.some((row) => row.ChatID === id && row.Kind === "capture.gap") && (
        <Alert role="note" className="mt-4 rounded-md border border-foreground/20 p-3 text-sm">
          Some live activity could not be captured while Flora was disconnected from OpenCode.
          Recovered message and tool snapshots are shown below. Transient output may be missing.
          Reconnecting does not replay accepted messages or actions.
        </Alert>
      )}
      {!blocked && (
        <>
          <div className="mt-4 flex flex-wrap gap-3" aria-label="Execution controls">
            {activeTurn && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  onControl("interrupt");
                }}
              >
                Interrupt current work
              </Button>
            )}
            {!stopped && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  onControl("stop");
                }}
              >
                Stop container
              </Button>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {stopped
              ? "Send a new message to restart this container with its saved workspace and conversation. Interrupted work is not replayed."
              : "Interrupt keeps the container running. Stop frees container capacity. Both preserve saved work and conversation."}
          </p>
        </>
      )}
      <ol aria-label="Conversation" className="mt-8 space-y-8">
        {detail.messages.map((m) => (
          <ConversationMessage key={m.ID} message={m} />
        ))}
      </ol>
      <Changes key={id} chatID={id} onExpired={onExpired} />
      {children}
      <form onSubmit={onSend} className="mt-8 space-y-4">
        <FieldLabel>
          Follow-up
          <Textarea
            className="mt-2 min-h-28"
            name="text"
            required
            disabled={busy || activeTurn || blocked}
            aria-describedby="followup-help"
          />
        </FieldLabel>
        <p id="followup-help" className="text-sm text-muted-foreground">
          {followUpHelp()}
        </p>
        <Button type="submit" disabled={busy || activeTurn || blocked}>
          {sendLabel()}
        </Button>
      </form>
      <details className="mt-10 rounded-md border border-foreground/20 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Full activity ({activity.length} saved events)
        </summary>
        <p className="mt-3 text-sm text-muted-foreground">
          Setup activity contains bounded previews. After setup finishes,{" "}
          <Link href={`/api/chats/${encodeURIComponent(id)}/setup-log`}>
            download the full redacted setup log
          </Link>
          . Any capture failure is shown in the final setup event.
        </p>
        <ol className="mt-4 space-y-3">
          {activity.map((row) => (
            <li key={row.Sequence}>
              <details>
                <summary className="cursor-pointer text-xs break-words">
                  {row.Kind} ·{" "}
                  <time dateTime={row.CreatedAt}>
                    {new Date(row.CreatedAt).toLocaleTimeString()}
                  </time>{" "}
                  · #{row.Sequence}
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto text-xs break-words whitespace-pre-wrap">
                  {JSON.stringify(row.Payload, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      </details>
      <details className="mt-4 rounded-md border border-foreground/20 p-4">
        <summary className="cursor-pointer text-sm font-medium">Environment snapshot</summary>
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
      </details>
    </>
  );
}

function ConversationMessage({ message: m }: { message: Message }) {
  const parts = m.Payload.parts ?? [];
  const failure = m.Payload.info?.error ?? null;
  return (
    <li className="min-w-0 rounded-md border border-foreground/20 p-4">
      <h2 className="text-sm font-semibold">
        {m.Role === "user" ? "You" : "Flora"}
        {m.Provider !== "" && (
          <span className="ml-2 font-normal break-all text-muted-foreground">
            {m.Provider}/{m.Model}
          </span>
        )}
      </h2>
      <div className="mt-3 space-y-4">
        {parts.length > 0 ? (
          parts.map((p, i) => <MessagePart key={p.id ?? i} part={p} />)
        ) : (
          <pre className="font-sans text-sm leading-6 break-words whitespace-pre-wrap">
            {m.Text}
          </pre>
        )}
      </div>
      {failure !== null && (
        <pre role="alert" className="mt-3 text-sm break-words whitespace-pre-wrap">
          {JSON.stringify(failure, null, 2)}
        </pre>
      )}
    </li>
  );
}

function MessagePart({ part: p }: { part: Part }) {
  if (p.type === "text") {
    return (
      <pre className="font-sans text-sm leading-6 break-words whitespace-pre-wrap">{p.text}</pre>
    );
  }
  if (p.type === "reasoning") {
    return (
      <details>
        <summary className="cursor-pointer text-sm">Reasoning</summary>
        <pre className="mt-2 text-sm break-words whitespace-pre-wrap">{p.text}</pre>
      </details>
    );
  }
  if (p.type === "tool") {
    const output = p.state?.output ?? "";
    const error = p.state?.error ?? "";
    return (
      <details open className="rounded-md border border-foreground/20 p-3">
        <summary className="cursor-pointer text-sm font-medium break-words">
          {p.tool} · {p.state?.status} {p.state?.title}
        </summary>
        <pre className="mt-3 overflow-auto text-xs break-words whitespace-pre-wrap">
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
      </details>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer text-sm">{p.type}</summary>
      <pre className="mt-2 overflow-auto text-xs break-words whitespace-pre-wrap">
        {JSON.stringify(p, null, 2)}
      </pre>
    </details>
  );
}
