import type { Chat } from "./chat-schemas";

export const organizationEvent = "flora:chat-organization";

export function publishOrganization(chat: Chat) {
  window.dispatchEvent(new CustomEvent<Chat>(organizationEvent, { detail: chat }));
}

/** Retains newer user metadata when an older feed or detail request arrives late. */
export function latestOrganization(incoming: Chat, saved?: Chat): Chat {
  if (!saved || (incoming.OrganizationRevision ?? 0) >= (saved.OrganizationRevision ?? 0)) {
    return incoming;
  }
  return {
    ...incoming,
    Title: saved.Title,
    Archived: saved.Archived,
    PinnedAt: saved.PinnedAt,
    OrganizationRevision: saved.OrganizationRevision,
  };
}

/** Pins stay in newest-pinned-first order while execution continues updating chats. */
export function pinnedChats(chats: Chat[]) {
  return chats
    .filter((chat) => (chat.PinnedAt ?? "") !== "" && chat.Archived !== true)
    .toSorted(
      (a, b) =>
        Date.parse(b.PinnedAt ?? "") - Date.parse(a.PinnedAt ?? "") || a.ID.localeCompare(b.ID),
    );
}
