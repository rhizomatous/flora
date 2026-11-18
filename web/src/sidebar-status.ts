import { useEffect, useState } from "react";
import { z } from "zod";

import type { Chat } from "./chat-schemas";
import { request } from "./request";

export const readEvent = "flora:chats-read";
export const viewedSchema = z.object({
  chatID: z.string(),
  revision: z.number().int().nonnegative(),
});
type Viewed = z.infer<typeof viewedSchema>;

export async function markChatsRead(chats: Chat[]) {
  // Capture all bounds before sending the first batch. Later feed updates must
  // never extend the scope of an action already in progress.
  const observed = chats.map((chat) => ({ chatID: chat.ID, revision: chat.ActivityRevision ?? 0 }));
  for (let offset = 0; offset < observed.length; offset += 1000) {
    // oxlint-disable-next-line no-await-in-loop -- Bound each request and preserve completed batches if a later one fails.
    const saved = await request(viewedSchema.array(), "chats/read", {
      method: "POST",
      body: { observed: observed.slice(offset, offset + 1000) },
    });
    window.dispatchEvent(new CustomEvent(readEvent, { detail: saved }));
  }
}

/** Retains an acknowledged position when an older feed request arrives late. */
export function latestRead(incoming: Chat, saved?: Chat): Chat {
  return {
    ...incoming,
    LastViewedRevision: Math.max(incoming.LastViewedRevision ?? 0, saved?.LastViewedRevision ?? 0),
  };
}

export function isChatSeen(chat: Chat) {
  return (chat.LastViewedRevision ?? 0) >= (chat.ActivityRevision ?? 0);
}

/** A visible, successfully loaded conversation acknowledges only its delivered revision. */
export function useMarkViewed(chat: Chat | undefined) {
  const id = chat?.ID;
  const revision = chat?.ActivityRevision;
  const saved = chat?.LastViewedRevision ?? 0;
  const [error, setError] = useState<{ chatID: string; message: string }>();
  useEffect(() => {
    if (id === undefined || id === "" || revision === undefined || saved >= revision) return;
    let active = true;
    let pending = false;
    let done = false;
    const mark = async () => {
      if (document.visibilityState !== "visible" || pending || done) return;
      pending = true;
      try {
        const result = await request(viewedSchema.array(), "chats/read", {
          method: "POST",
          body: { observed: [{ chatID: id, revision }] },
        });
        window.dispatchEvent(new CustomEvent<Viewed[]>(readEvent, { detail: result }));
        done = true;
        if (active) setError(undefined);
      } catch {
        if (active) setError({ chatID: id, message: "Could not save read state. Retrying…" });
      } finally {
        pending = false;
      }
    };
    void mark();
    const visible = () => {
      void mark();
    };
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(visible, 3000);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [id, revision, saved]);
  return error !== undefined && error.chatID === id && saved < (revision ?? 0) ? error.message : "";
}
