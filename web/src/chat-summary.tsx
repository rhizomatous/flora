import { useEffect, useState } from "react";

import { ChatModelSummary } from "./chat-model-summary";
import type { Chat } from "./chat-schemas";
import { chatStatus } from "./chat-status";
import { PullCount, PullList } from "./pull-links";
import type { PullSummary } from "./pull-schemas";

/** Title and sidebar previews show the same saved identity and useful related work. */
export function ChatSummary({
  chat,
  title,
  pulls,
  now: suppliedNow,
  showPullList = true,
}: {
  chat: Chat | undefined;
  title: string;
  pulls: PullSummary | undefined;
  now?: number;
  showPullList?: boolean;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (suppliedNow !== undefined) return;
    const timer = setInterval(() => {
      setClock(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [suppliedNow]);
  const age = chat ? Math.max(0, (suppliedNow ?? clock) - Date.parse(chat.UpdatedAt)) : Number.NaN;
  let relative = "";
  if (Number.isFinite(age)) {
    if (age < 60_000) relative = "Just now";
    else if (age < 3_600_000) relative = `${Math.floor(age / 60_000)}m ago`;
    else if (age < 86_400_000) relative = `${Math.floor(age / 3_600_000)}h ago`;
    else relative = `${Math.floor(age / 86_400_000)}d ago`;
  }
  return (
    <div className="chat-summary">
      <div className="chat-summary-meta">
        {chat && (
          <span className="chat-summary-id" title={chat.ID} aria-label={`Chat ID: ${chat.ID}`}>
            Chat {chat.ID.slice(0, 6)}
          </span>
        )}
        {chat && <ChatModelSummary key={chat.ID} chat={chat} />}
      </div>
      <p className="chat-summary-title">{title}</p>
      <div className="chat-summary-footer">
        <span title={chat?.StatusReason}>{chat ? chatStatus(chat).label : "Loading"}</span>
        {chat && relative && (
          <time dateTime={chat.UpdatedAt} title={new Date(chat.UpdatedAt).toLocaleString()}>
            {relative}
          </time>
        )}
        {!showPullList && (pulls?.items.length ?? 0) > 0 && (
          <PullCount pulls={pulls?.items ?? []} />
        )}
      </div>
      {showPullList && ((pulls?.items.length ?? 0) > 0 || (pulls?.error ?? "") !== "") && (
        <section aria-label="Pull requests" className="chat-summary-section">
          <p className="chat-summary-section-label">Pull requests</p>
          <PullList summary={pulls} chatID={chat?.ID} />
        </section>
      )}
      {chat && (
        <a
          href={`#mcps?chat=${encodeURIComponent(chat.ID)}`}
          className="mt-3 inline-block rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          MCP servers
        </a>
      )}
      {(chat?.subagents?.length ?? 0) > 0 && (
        <section aria-label="Subagents" className="chat-summary-section">
          <p className="chat-summary-section-label">Subagents</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            {chat?.subagents?.map((agent) => (
              <div key={agent.id} className="contents">
                <dt className="text-muted-foreground">Subagent {agent.number}</dt>
                <dd className="min-w-0 wrap-anywhere">{agent.title || "Delegated task"}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
