import { createContext, useContext } from "react";

import type { PullSummary } from "./pull";

export const ChatPullContext = createContext<PullSummary | undefined>(undefined);

export function useLinkedPull(href: string | undefined) {
  const summary = useContext(ChatPullContext);
  const match =
    /^https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?:[/?#]|$)/i.exec(
      href ?? "",
    );
  if (!match) return;
  const canonical = `https://github.com/${match[1]}/pull/${match[2]}`.toLowerCase();
  return summary?.items?.find((pull) => pull.url.toLowerCase() === canonical);
}
