import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  Alert,
  Button,
  ButtonLink,
  FieldLabel,
  Heading,
  Link,
  NativeSelect,
  Text,
  Textarea,
} from "@flora/florets";

import { ChatDetail, type Activity, type Detail } from "./chat-view";
import type { Chat } from "./notifications";
import { QuestionForm, type Question } from "./question";
import { errorMessage, isExpired, request } from "./request";
import { text } from "./ui";

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

  const detailClass = id === "" ? "min-w-0" : "chat-detail";

  function title() {
    if (isNew) return "New chat";
    if (id === "") return "Chats";
    const saved = detail?.chat.Title ?? "";
    return saved === "" ? "Chat" : saved;
  }

  return (
    <section aria-labelledby="chats-heading" className={isNew ? "new-chat" : detailClass}>
      <div
        className={
          isNew || detail !== undefined ? "sr-only" : "flex items-center justify-between gap-4"
        }
      >
        <Heading
          level={1}
          id="chats-heading"
          ref={heading}
          tabIndex={-1}
          className="min-w-0 break-words"
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
          className="space-y-1"
        >
          <div className="flex flex-wrap items-center gap-3">
            <FieldLabel className="sr-only" htmlFor="new-chat-project">
              Project
            </FieldLabel>
            <NativeSelect
              id="new-chat-project"
              name="project"
              className="project-picker"
              defaultValue={projectID || projects[0]?.id}
              required
              disabled={busy}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="chat-composer">
            <FieldLabel className="sr-only" htmlFor="new-chat-message">
              Message
            </FieldLabel>
            <Textarea
              id="new-chat-message"
              name="text"
              className="composer-message"
              placeholder="What are we building?"
              required
              disabled={busy}
            />
            <div className="composer-actions">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Starting…" : "Start chat"}
              </Button>
            </div>
          </div>
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
              <ul className="mt-3 divide-y divide-foreground/20">
                {chats.map((c) => (
                  <li key={c.ID} className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <Link href={`#chats/${c.ID}`} className="font-medium break-words">
                        {c.Title}
                      </Link>
                      <Text tone="muted" className="mt-1">
                        {statusName(c.Status)} ·{" "}
                        <time dateTime={c.UpdatedAt}>{new Date(c.UpdatedAt).toLocaleString()}</time>
                      </Text>
                    </div>
                    <Text as="span" tone="muted" className="max-w-md">
                      {c.StatusReason}
                    </Text>
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
