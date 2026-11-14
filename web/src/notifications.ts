import { useEffect, useEffectEvent, useState } from "react";

import { feedSchema, type Chat, type Completion } from "./chat-schemas";
import { isExpired, request } from "./request";
import { useCompletionSound } from "./sound";

export type Toast = Completion & { title: string };

/**
 * Polls the app-wide feed that supplies both the chat list and completion toasts. The cursor
 * survives navigation and connection failures, but each fresh page skips earlier completions.
 * Everything resets when `authenticated` changes.
 */
export function useNotifications(authenticated: boolean, sound: boolean, onExpired: () => void) {
  const [chats, setChats] = useState<Chat[]>();
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const audio = useCompletionSound(sound);
  const play = useEffectEvent(audio.play);
  const expire = useEffectEvent(onExpired);
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    let loading = false;
    let cursor: number | undefined;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const feed = await request(
          feedSchema,
          cursor === undefined ? "notifications" : `notifications?after=${cursor}`,
        );
        if (!active) return;
        const fresh = feed.completions.filter((e) => e.Sequence > (cursor ?? feed.cursor));
        cursor = feed.cursor;
        setChats(feed.chats);
        setError("");
        if (fresh.length === 0) return;
        const title = (id: string) => feed.chats.find((c) => c.ID === id)?.Title ?? "Chat";
        setToasts((rows) => [...rows, ...fresh.map((e) => ({ ...e, title: title(e.ChatID) }))]);
        play();
      } catch (error_) {
        if (!active) return;
        setError(
          "Chat updates and completion notifications disconnected. Reconnecting automatically…",
        );
        if (isExpired(error_)) expire();
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
      setChats(undefined);
      setToasts([]);
      setError("");
    };
  }, [authenticated]);

  function dismiss(sequence: number) {
    setToasts((rows) => rows.filter((row) => row.Sequence !== sequence));
    document.querySelector("h1")?.focus();
  }
  return { chats, error, toasts, dismiss, audio };
}
