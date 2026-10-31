import { useEffect, useRef, useState, type FormEvent } from "react";
import { request, RequestError } from "./request";
import { FlowerMark } from "@flora/florets";
import { Changes } from "./changes";

type Chat = { ID: string; ProjectID: string; Title: string; Status: "working" | "waiting" | "failed" | "idle" | "stopped"; StatusReason: string; UpdatedAt: string; ImageDigest: string; HarnessVersion: string; StartingCommits: Record<string, string> };
type Part = { id?: string; type: string; text?: string; tool?: string; state?: { status: string; input?: unknown; output?: string; error?: string; title?: string } };
type Message = { ID: string; Role: string; Text: string; Provider: string; Model: string; Payload: { parts?: Part[]; info?: { error?: unknown } } };
type Activity = { Sequence: number; Kind: string; CreatedAt: string; Payload: unknown };
type Detail = { chat: Chat; messages: Message[] };
type Project = { id: string; name: string };
type Question = { id: string; questions: { question: string; header: string; multiple: boolean; custom?: boolean; options: { label: string; description: string }[] }[] };
const control = "mt-2 w-full rounded-md border border-foreground/30 bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-60";
const button = "rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50";
const link = "underline underline-offset-4";
const statusName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Keep the accepted identity across ambiguous responses and page reloads.
// A changed input is a new request, never an edit to an accepted turn.
function identity(scope: string, input: unknown) {
  const key = `flora-request:${scope}`;
  const body = JSON.stringify(input);
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved?.body === body) return saved.id as string;
  } catch { /* Invalid or unavailable session storage does not prevent sending. */ }
  const id = crypto.randomUUID();
  try { sessionStorage.setItem(key, JSON.stringify({ body, id })); } catch { /* Private browsing can disable storage. */ }
  return id;
}

export function Chats({ path, onExpired }: { path: string; onExpired: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [list, setList] = useState<Chat[]>();
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
  const creating = id === "new";
  const projectID = new URLSearchParams(path.split("?")[1]).get("project") || "";
  const isNew = creating || id.startsWith("new?");

  function report(e: unknown) {
    setError(e instanceof Error ? e.message : "Could not load chat.");
    if (e instanceof RequestError && e.status === 401) onExpired();
  }

  useEffect(() => {
    let active = true;
    heading.current?.focus();
    request<Project[]>("projects").then(p => { if (active) setProjects(p); }).catch(e => { if (active) report(e); });
    if (!id) {
      const load = () => request<Chat[]>("chats").then(c => { if (active) setList(c); }).catch(e => { if (active) report(e); });
      load();
      const timer = window.setInterval(load, 1000);
      return () => { active = false; clearInterval(timer); };
    }
    if (isNew) return () => { active = false; };
    let refreshing = false;
    let dirty = false;
    const refresh = async () => {
      dirty = true;
      if (refreshing) return;
      refreshing = true;
      try {
        while (active && dirty) {
          dirty = false;
          const d = await request<Detail>(`chats/${encodeURIComponent(id)}`);
          if (active) setDetail(d);
        }
      } catch (e) { if (active) report(e); }
      finally { refreshing = false; }
    };
    refresh();
    const source = new EventSource(`/api/chats/${encodeURIComponent(id)}/events`);
    source.onopen = () => { if (active) setConnection("Live"); };
    source.onerror = () => {
      if (!active) return;
      setConnection("Disconnected. Reconnecting to saved activity…");
      request<{ authenticated: boolean }>("auth/status").then(s => { if (active && !s.authenticated) { source.close(); onExpired(); } }).catch(() => {});
    };
    let debounce: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("activity", event => {
      if (!active) return;
      try {
        const row: Activity = JSON.parse((event as MessageEvent).data);
        setActivity(rows => rows.some(r => r.Sequence === row.Sequence) ? rows : [...rows, row]);
        if (!debounce) debounce = setTimeout(() => { debounce = undefined; refresh(); }, 100);
      } catch { setError("Could not read saved activity. Reload to reconnect."); }
    });
    const pollQuestions = async () => {
      try {
        const q = await request<Question[]>(`chats/${encodeURIComponent(id)}/questions`);
        if (active) { setQuestions(q); setQuestionError(""); }
      } catch (e) { if (active) { setQuestions([]); setQuestionError("Live questions unavailable. Saved questions may no longer be pending."); if (e instanceof RequestError && e.status === 401) onExpired(); } }
    };
    pollQuestions();
    const timer = window.setInterval(pollQuestions, 1000);
    return () => { active = false; source.close(); clearInterval(timer); if (debounce) clearTimeout(debounce); };
  }, [id, isNew]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const text = String(fields.get("text") || "");
    if (!text.trim() || new TextEncoder().encode(text).length > 131072) { setError("Enter a message of at most 128 KiB UTF-8."); return; }
    submitting.current = true; setBusy(true); setError("");
    try {
      const input = isNew ? { title: String(fields.get("title")), text } : { text };
      const scope = isNew ? `project:${fields.get("project")}` : `chat:${id}`;
      const requestID = identity(scope, input);
      if (isNew) {
        const c = await request<Chat>(`projects/${encodeURIComponent(String(fields.get("project")))}/chats`, "POST", { ...input, requestID });
        window.location.hash = `chats/${c.ID}`;
      } else {
        await request(`chats/${encodeURIComponent(id)}/messages`, "POST", { text, requestID });
        form.reset();
        setDetail(await request<Detail>(`chats/${encodeURIComponent(id)}`));
      }
      try { sessionStorage.removeItem(`flora-request:${scope}`); } catch { /* Storage may be disabled. */ }
    } catch (e) { report(e); }
    finally { submitting.current = false; setBusy(false); }
  }

  async function controlWork(action: "interrupt" | "stop") {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      await request(`chats/${encodeURIComponent(id)}/${action}`, "POST", {});
      setQuestions([]);
    } catch (e) { report(e); }
    finally {
      try { setDetail(await request<Detail>(`chats/${encodeURIComponent(id)}`)); } catch (e) { report(e); }
      submitting.current = false; setBusy(false);
    }
  }

  const activeTurn = detail?.chat.Status === "working" || detail?.chat.Status === "waiting";
  return <section aria-labelledby="chats-heading" className="min-w-0">
    <div className="flex items-center justify-between gap-4">
      <h1 id="chats-heading" ref={heading} tabIndex={-1} className="min-w-0 break-words text-2xl font-semibold tracking-tight">{isNew ? "New chat" : id ? detail?.chat.Title || "Chat" : "Chats"}</h1>
      <a className={`${link} shrink-0 text-sm`} href={id ? "#chats" : "#chats/new"}>{id ? "All chats" : "New chat"}</a>
    </div>
    {error && <p role="alert" className="mt-6 rounded-md border p-3 text-sm">{error}</p>}
    {!id && list && (list.length ? <div className="mt-8 space-y-8">{projects.map(p => {
      const chats = list.filter(c => c.ProjectID === p.id);
      return chats.length > 0 && <section key={p.id} aria-labelledby={`project-${p.id}`}><h2 id={`project-${p.id}`} className="font-semibold"><a href={`#projects/${p.id}`} className={link}>{p.name}</a></h2><ul className="mt-3 divide-y divide-foreground/20">{chats.map(c => <li key={c.ID} className="flex flex-wrap items-start justify-between gap-3 py-4"><div className="min-w-0"><a href={`#chats/${c.ID}`} className={`${link} break-words font-medium`}>{c.Title}</a><p className="mt-1 text-sm text-muted-foreground">{statusName(c.Status)} · <time dateTime={c.UpdatedAt}>{new Date(c.UpdatedAt).toLocaleString()}</time></p></div><span className="max-w-md text-sm text-muted-foreground">{c.StatusReason}</span></li>)}</ul></section>;
    })}</div> : <p className="mt-8 text-sm text-muted-foreground">No chats yet. Start a chat in a connected project.</p>)}
    {!id && !list && !error && <p role="status" className="mt-8">Loading…</p>}
    {isNew && <form onSubmit={send} className="mt-8 space-y-6">
      <label className="block text-sm font-medium">Project<select name="project" className={control} defaultValue={projectID} required disabled={busy}><option value="">Choose a project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {!projects.length && <p className="text-sm"><a href="#projects/new" className={link}>Connect a project</a> before starting a chat.</p>}
      <label className="block text-sm font-medium">Chat title<input name="title" className={control} required maxLength={200} disabled={busy} /></label>
      <label className="block text-sm font-medium">Message<textarea name="text" className={`${control} min-h-40`} required disabled={busy} aria-describedby="message-limit" /></label>
      <p id="message-limit" className="text-sm text-muted-foreground">Up to 128 KiB UTF-8. Checkout and setup run before Flora starts work.</p>
      <button className={button} disabled={busy || !projects.length}>{busy ? "Starting…" : "Start chat"}</button>
    </form>}
    {id && !isNew && !detail && !error && <p role="status" className="mt-8">Loading…</p>}
    {detail && <>
      <div role="status" className="mt-6 flex flex-wrap items-center gap-2 rounded-md border border-foreground/20 p-3 text-sm">{detail.chat.Status === "working" && <FlowerMark />}<strong>{statusName(detail.chat.Status)}</strong><span>{detail.chat.StatusReason}</span></div>
      <p role="status" className="mt-2 text-xs text-muted-foreground">{connection} · {projects.find(p => p.id === detail.chat.ProjectID)?.name}</p>
      <div className="mt-4 flex flex-wrap gap-3" aria-label="Execution controls">
        {activeTurn && <button type="button" className={button} disabled={busy} onClick={() => controlWork("interrupt")}>Interrupt current work</button>}
        {detail.chat.Status !== "stopped" && <button type="button" className={button} disabled={busy} onClick={() => controlWork("stop")}>Stop container</button>}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{detail.chat.Status === "stopped" ? "Send a new message to restart this container with its saved workspace and conversation. Interrupted work is not replayed." : "Interrupt keeps the container running. Stop frees container capacity. Both preserve saved work and conversation."}</p>
      <ol aria-label="Conversation" className="mt-8 space-y-8">{detail.messages.map(m => <li key={m.ID} className="min-w-0 rounded-md border border-foreground/20 p-4">
        <h2 className="text-sm font-semibold">{m.Role === "user" ? "You" : "Flora"}{m.Provider && <span className="ml-2 break-all font-normal text-muted-foreground">{m.Provider}/{m.Model}</span>}</h2>
        <div className="mt-3 space-y-4">{m.Payload.parts?.length ? m.Payload.parts.map((p, i) => <MessagePart key={p.id || i} part={p} />) : <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{m.Text}</pre>}</div>
        {m.Payload.info?.error != null && <pre role="alert" className="mt-3 whitespace-pre-wrap break-words text-sm">{JSON.stringify(m.Payload.info.error, null, 2)}</pre>}
      </li>)}</ol>
      <Changes key={id} chatID={id} onExpired={onExpired} />
      {questionError && <p className="mt-6 text-sm" role="status">{questionError}</p>}
      {questions.map(q => <QuestionForm key={q.id} question={q} chatID={id} onError={report} onAnswered={() => setQuestions(rows => rows.filter(row => row.id !== q.id))} />)}
      <form onSubmit={send} className="mt-8 space-y-4">
        <label className="block text-sm font-medium">Follow-up<textarea className={`${control} min-h-28`} name="text" required disabled={busy || activeTurn} aria-describedby="followup-help" /></label>
        <p id="followup-help" className="text-sm text-muted-foreground">{activeTurn ? "Wait for the current turn to finish or answer Flora’s question. Messages are not queued." : "Continue in the same workspace and conversation. Up to 128 KiB UTF-8."}</p>
        <button className={button} disabled={busy || activeTurn}>{busy ? "Working…" : detail.chat.Status === "stopped" ? "Resume with new message" : "Send message"}</button>
      </form>
      <details className="mt-10 rounded-md border border-foreground/20 p-4"><summary className="cursor-pointer text-sm font-medium">Full activity ({activity.length} saved events)</summary><p className="mt-3 text-sm text-muted-foreground">Setup activity contains bounded previews. After setup finishes, <a className={link} href={`/api/chats/${encodeURIComponent(id)}/setup-log`}>download the full redacted setup log</a>. Any capture failure is shown in the final setup event.</p><ol className="mt-4 space-y-3">{activity.map(row => <li key={row.Sequence}><details><summary className="cursor-pointer break-words text-xs">{row.Kind} · <time dateTime={row.CreatedAt}>{new Date(row.CreatedAt).toLocaleTimeString()}</time> · #{row.Sequence}</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(row.Payload, null, 2)}</pre></details></li>)}</ol></details>
      <details className="mt-4 rounded-md border border-foreground/20 p-4"><summary className="cursor-pointer text-sm font-medium">Environment snapshot</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ image: detail.chat.ImageDigest, OpenCode: detail.chat.HarnessVersion, startingCommits: detail.chat.StartingCommits }, null, 2)}</pre></details>
    </>}
  </section>;
}

function MessagePart({ part: p }: { part: Part }) {
  if (p.type === "text") return <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{p.text}</pre>;
  if (p.type === "reasoning") return <details><summary className="cursor-pointer text-sm">Reasoning</summary><pre className="mt-2 whitespace-pre-wrap break-words text-sm">{p.text}</pre></details>;
  if (p.type === "tool") return <details open className="rounded-md border border-foreground/20 p-3"><summary className="cursor-pointer break-words text-sm font-medium">{p.tool} · {p.state?.status} {p.state?.title}</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(p.state?.input, null, 2)}</pre>{p.state?.output && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{p.state.output}</pre>}{p.state?.error && <pre role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs">{p.state.error}</pre>}</details>;
  return <details><summary className="cursor-pointer text-sm">{p.type}</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(p, null, 2)}</pre></details>;
}

function QuestionForm({ question: q, chatID, onError, onAnswered }: { question: Question; chatID: string; onError: (e: unknown) => void; onAnswered: () => void }) {
  const [busy, setBusy] = useState(false);
  async function answer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fields = new FormData(e.currentTarget);
    const answers = q.questions.map((_, i) => {
      const custom = String(fields.get(`custom-${i}`) || "").trim();
      return custom ? [custom] : fields.getAll(`option-${i}`).map(String);
    });
    if (answers.some(a => !a.length)) { onError(new Error("Answer each question before continuing.")); return; }
    setBusy(true);
    try { await request(`chats/${encodeURIComponent(chatID)}/questions/${encodeURIComponent(q.id)}/reply`, "POST", { answers }); onAnswered(); }
    catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  return <form onSubmit={answer} className="mt-8 space-y-5 rounded-md border p-4"><h2 className="font-semibold">Flora needs your answer</h2>{q.questions.map((question, i) => <fieldset key={i} disabled={busy} className="space-y-3"><legend className="mb-3 text-sm font-medium">{question.header}: {question.question}</legend>{question.options.map(option => <label key={option.label} className="flex gap-3 text-sm"><input type={question.multiple ? "checkbox" : "radio"} name={`option-${i}`} value={option.label} /><span>{option.label}<span className="block text-muted-foreground">{option.description}</span></span></label>)}{question.custom !== false && <label className="block text-sm">Other answer (replaces selected options)<input name={`custom-${i}`} className={control} maxLength={8192} /></label>}</fieldset>)}<button className={button} disabled={busy}>{busy ? "Answering…" : "Answer and continue"}</button></form>;
}
