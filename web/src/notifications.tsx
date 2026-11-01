import { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./request";
import { useCompletionSound } from "./sound";

export type Chat = { ID: string; ProjectID: string; Title: string; Status: "working" | "waiting" | "failed" | "idle" | "stopped"; StatusReason: string; UpdatedAt: string; ImageDigest: string; HarnessVersion: string; StartingCommits: Record<string, string> };
type Completion = { ChatID: string; Sequence: number };
type Feed = { chats: Chat[]; completions: Completion[]; cursor: number };
type Toast = Completion & { title: string };

// One app-wide poll supplies both the chat list and completion alerts. Its cursor
// survives navigation and connection failures, but each fresh page skips history.
export function useNotifications(authenticated: boolean, sound: boolean, onExpired: () => void) {
  const [chats, setChats] = useState<Chat[]>();
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const audio = useCompletionSound(sound);
  const handlers = useRef({ play: audio.play, onExpired });
  handlers.current = { play: audio.play, onExpired };
  useEffect(() => {
    setChats(undefined); setToasts([]); setError("");
    if (!authenticated) return;
    let active = true;
    let loading = false;
    let cursor: number | undefined;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const feed = await request<Feed>(`notifications${cursor === undefined ? "" : `?after=${cursor}`}`);
        if (!active) return;
        const fresh = feed.completions.filter(e => e.Sequence > (cursor ?? feed.cursor));
        cursor = feed.cursor;
        setChats(feed.chats); setError("");
        if (fresh.length) {
          setToasts(rows => [...rows, ...fresh.map(e => ({ ...e, title: feed.chats.find(c => c.ID === e.ChatID)?.Title || "Chat" }))]);
          handlers.current.play();
        }
      } catch (e) {
        if (!active) return;
        setError("Chat updates and completion notifications disconnected. Reconnecting automatically…");
        if (e instanceof RequestError && e.status === 401) handlers.current.onExpired();
      } finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(load, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [authenticated]);

  function dismiss(sequence: number) {
    setToasts(rows => rows.filter(row => row.Sequence !== sequence));
    document.querySelector<HTMLHeadingElement>("h1")?.focus();
  }
  return { chats, error, toasts, dismiss, audio };
}

export function CompletionToasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (sequence: number) => void }) {
  return <aside aria-label="Completion notifications" aria-live="polite" aria-relevant="additions" className="fixed bottom-4 right-4 z-10 max-h-[40svh] w-[calc(100%-2rem)] max-w-sm space-y-3 overflow-auto rounded-md">
    {toasts.map(t => <div key={t.Sequence} className="rounded-md border border-foreground/40 bg-background p-4 shadow-lg">
      <p className="break-words text-sm"><a className="font-medium underline underline-offset-4" href={`#chats/${encodeURIComponent(t.ChatID)}`}>{t.title}</a> finished work.</p>
      <button type="button" className="mt-3 text-sm underline underline-offset-4" aria-label={`Dismiss completion for ${t.title}`} onClick={() => dismiss(t.Sequence)}>Dismiss</button>
    </div>)}
  </aside>;
}
