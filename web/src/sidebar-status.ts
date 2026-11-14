import { useEffect, useState } from "react";

import type { Chat } from "./chat-schemas";

function revision(chat: Chat) {
  return JSON.stringify([chat.Status, chat.StatusReason, chat.UpdatedAt]);
}

/** Records the attention state viewed in this tab; a later status update becomes unread again. */
export function useSeenSidebarChats(chats: Chat[] | undefined, path: string) {
  const [seen, setSeen] = useState<Record<string, string>>({});
  const current = chats?.find((chat) => path === `chats/${chat.ID}`);
  const id = current?.ID;
  const version = current && revision(current);
  useEffect(() => {
    if (id === undefined || version === undefined) return;
    const markSeen = () => {
      if (document.visibilityState !== "visible") return;
      try {
        sessionStorage.setItem(`flora-seen:${id}`, version);
      } catch {
        // Keep the current tab's in-memory state when browser storage is unavailable.
      }
      setSeen((previous) => (previous[id] === version ? previous : { ...previous, [id]: version }));
    };
    markSeen();
    document.addEventListener("visibilitychange", markSeen);
    return () => {
      document.removeEventListener("visibilitychange", markSeen);
    };
  }, [id, version]);
  return (chat: Chat) => {
    const value = revision(chat);
    if (seen[chat.ID] === value) return true;
    try {
      return sessionStorage.getItem(`flora-seen:${chat.ID}`) === value;
    } catch {
      return false;
    }
  };
}
