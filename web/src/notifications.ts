import { useEffect, useEffectEvent, useState } from "react";

import { latestOrganization, organizationEvent } from "./chat-organization";
import { feedSchema, chatSchema, type Chat, type Completion } from "./chat-schemas";
import { isExpired, request } from "./request";
import { latestRead, readEvent, viewedSchema } from "./sidebar-status";
import { useCompletionSound } from "./sound";

export type Toast = Completion & { title: string; publicChatID: string };

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
        setChats((saved) =>
          feed.chats.map((chat) =>
            latestRead(
              latestOrganization(
                chat,
                saved?.find((row) => row.ID === chat.ID),
              ),
              saved?.find((row) => row.ID === chat.ID),
            ),
          ),
        );
        setError("");
        if (fresh.length === 0) return;
        const completed = fresh.flatMap((event) => {
          const chat = feed.chats.find((row) => row.ID === event.ChatID);
          return chat ? [{ ...event, title: chat.Title, publicChatID: chat.PublicID }] : [];
        });
        setToasts((rows) => [...rows, ...completed]);
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
    const organize = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = chatSchema.safeParse(event.detail);
      if (!parsed.success) return;
      const chat = parsed.data;
      setChats((rows) => {
        const saved = rows ?? [];
        if (!saved.some((row) => row.ID === chat.ID)) return [...saved, chat];
        return saved.map((row) =>
          row.ID === chat.ID ? latestRead(latestOrganization(chat, row), row) : row,
        );
      });
    };
    const read = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = viewedSchema.array().safeParse(event.detail);
      if (!parsed.success) return;
      const positions = new Map(parsed.data.map((item) => [item.chatID, item.revision]));
      setChats((rows) =>
        rows?.map((chat) => ({
          ...chat,
          LastViewedRevision: Math.max(chat.LastViewedRevision ?? 0, positions.get(chat.ID) ?? 0),
        })),
      );
    };
    window.addEventListener(readEvent, read);
    window.addEventListener(organizationEvent, organize);
    void load();
    const timer = setInterval(() => {
      void load();
    }, 1000);
    return () => {
      active = false;
      window.removeEventListener(readEvent, read);
      window.removeEventListener(organizationEvent, organize);
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
