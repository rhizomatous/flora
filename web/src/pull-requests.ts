import type { Chat } from "./notifications";
import type { Pull } from "./pull";

export type TrackedPull = {
  pull: Pull;
  repository: string;
  chats: Chat[];
  checkedAt: string;
  stale: boolean;
};

// One PR can belong to several chats. Prefer the newest successful verification,
// retaining every chat link and keeping repositories with the same PR number distinct.
export function collectPullRequests(chats: Chat[]): TrackedPull[] {
  const rows = new Map<string, TrackedPull>();
  for (const chat of chats) {
    for (const pull of chat.pulls?.items ?? []) {
      const key = pull.url.toLowerCase();
      const checkedAt = chat.pulls?.checkedAt ?? "";
      const stale = (chat.pulls?.error ?? "") !== "";
      const previous = rows.get(key);
      const associated = previous?.chats ?? [];
      if (!associated.some((item) => item.ID === chat.ID)) associated.push(chat);
      const newer = (Date.parse(checkedAt) || 0) > (Date.parse(previous?.checkedAt ?? "") || 0);
      if (!previous || (previous.stale && !stale) || (previous.stale === stale && newer)) {
        rows.set(key, {
          pull,
          repository: pull.repository ?? pull.url.split("/").slice(3, 5).join("/"),
          chats: associated,
          checkedAt,
          stale,
        });
      }
    }
  }
  return [...rows.values()].toSorted(
    (a, b) => a.repository.localeCompare(b.repository) || b.pull.number - a.pull.number,
  );
}
