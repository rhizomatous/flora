import { useEffect, useState } from "react";

import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
} from "@flora/florets";

import { type Message, type Subagent, subagentDetailSchema } from "./chat-schemas";
import { ConversationMessage, WorkSummary } from "./conversation";
import { request, isExpired, errorMessage } from "./request";
import { useSubagents, subagentLabel, subagentStatus } from "./subagent-state";
import { buildTranscript } from "./transcript";

export function SubagentConversation({
  agent,
  onExpired,
}: {
  agent: Subagent;
  onExpired: () => void;
}) {
  const { chatID } = useSubagents();
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const detail = await request(
          subagentDetailSchema,
          `chats/${encodeURIComponent(chatID)}/subagents/${encodeURIComponent(agent.id)}`,
        );
        if (active) {
          setMessages(detail.messages);
          setError("");
          setLoaded(true);
        }
      } catch (e) {
        if (active) {
          setError(errorMessage(e, "Could not load subagent."));
          if (isExpired(e)) onExpired();
        }
      }
    }
    // A newly saved snapshot invalidates the displayed transcript.
    if (agent.updatedAt !== "") void load();
    return () => {
      active = false;
    };
  }, [chatID, agent.id, agent.updatedAt, onExpired]);
  const rows = buildTranscript(
    messages,
    agent.collection === "complete" ? agent.status : "stopped",
  );
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label={`${subagentLabel(agent)} conversation`}>
          <MessageScrollerContent className="mx-auto w-full max-w-[900px] gap-6 px-4 py-6">
            <div className="space-y-2">
              <h2 className="text-sm font-medium">{agent.title || "Delegated task"}</h2>
              <p className="text-xs text-muted-foreground">{subagentStatus(agent)}</p>
              {agent.collection !== "complete" && (
                <p role="status" className="text-sm text-muted-foreground">
                  Showing saved messages. Some history may be missing.
                </p>
              )}
            </div>
            {error && <p role="alert">{error}</p>}
            {!loaded && !error && <p role="status">Loading conversation…</p>}
            {loaded && messages.length === 0 && (
              <p className="text-sm text-muted-foreground">No messages captured yet.</p>
            )}
            {rows.map((row) => (
              <MessageScrollerItem
                key={row.id}
                messageId={row.id}
                scrollAnchor={row.kind === "message" && row.message.Role === "user"}
              >
                {row.kind === "work" ? (
                  <WorkSummary steps={row.steps} active={row.active} failed={row.failed} />
                ) : (
                  <ConversationMessage message={row.message} delegated />
                )}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
