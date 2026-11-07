import { useRef } from "react";

import {
  Alert,
  Button,
  FieldLabel,
  FlowerMark,
  Heading,
  Link,
  Text,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@flora/florets";
import {
  ChatProvider,
  Chat as Conversation,
  ChatViewport,
  ChatContent,
  ChatItem,
  ChatScrollButton,
  Message as MessageLayout,
  MessageContent,
  Bubble,
  Tool,
  Reasoning,
  CodeBlock,
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
} from "@flora/florets/ai";

import { Changes } from "./changes";
import { MarkdownMessage } from "./markdown-message";
import type { Chat } from "./notifications";

export type Part = {
  id?: string;
  type: string;
  text?: string;
  tool?: string;
  state?: { status: string; input?: unknown; output?: string; error?: string; title?: string };
};
export type Message = {
  ID: string;
  Role: string;
  Text: string;
  Provider: string;
  Model: string;
  Payload: { parts?: Part[]; info?: { error?: unknown } };
};
export type Activity = {
  ChatID: string;
  Sequence: number;
  Kind: string;
  CreatedAt: string;
  Payload: unknown;
};
export type Detail = { chat: Chat; messages: Message[]; continuationBlockedReason?: string };

/** Keeps the transcript independently scrollable and follows updates only while the reader is at its end. */
export function ChatDetail({
  id,
  detail,
  activity,
  connection,
  projectName,
  busy,
  messageBytes,
  onExpired,
  onControl,
  onSend,
  children,
}: {
  id: string;
  detail: Detail;
  activity: Activity[];
  connection: string;
  projectName: string | undefined;
  busy: boolean;
  messageBytes: number;
  onExpired: () => void;
  onControl: (action: "interrupt" | "stop") => void;
  onSend: (event: React.SubmitEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const { chat } = detail;
  const activeTurn = chat.Status === "working" || chat.Status === "waiting";
  const stopped = chat.Status === "stopped";
  const blocked = (detail.continuationBlockedReason ?? "") !== "";
  const changes = useRef<HTMLDialogElement>(null);
  const diagnostics = useRef<HTMLDialogElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const openingDiagnostics = useRef(false);

  let sendLabel = stopped ? "Resume with new message" : "Send message";
  if (blocked) sendLabel = "Continuation unavailable";
  let help = chat.StatusReason;
  if (activeTurn) {
    help =
      "Wait for the current turn to finish or answer Flora’s question. Messages are not queued.";
  }
  if (blocked) {
    help = "Continuation is unavailable. Saved conversation and workspace files are retained.";
  }

  return (
    <ChatProvider autoScroll defaultScrollPosition="end">
      <div className="chat-layout">
        <header className="chat-header">
          <div className="chat-heading">
            <span className="chat-title">{chat.Title || "Chat"}</span>
            <span role="status" className="chat-status">
              {chat.Status === "working" && <FlowerMark />}
              {chat.Status.charAt(0).toUpperCase() + chat.Status.slice(1)}
            </span>
          </div>
          <div className="chat-header-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                changes.current?.showModal();
              }}
            >
              Changes
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button ref={moreTrigger} variant="ghost" size="sm" aria-label="Chat options">
                  •••
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (openingDiagnostics.current) {
                    event.preventDefault();
                    openingDiagnostics.current = false;
                    diagnostics.current?.showModal();
                  }
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    openingDiagnostics.current = true;
                  }}
                >
                  Activity and environment
                </DropdownMenuItem>
                {!blocked && !stopped && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      onControl("stop");
                    }}
                  >
                    Stop container
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <Conversation>
          <ChatViewport className="chat-scroll" aria-label="Chat history">
            <ChatContent role="list" aria-label="Conversation" className="conversation">
              {detail.messages.map((m) => (
                <ChatItem
                  role="listitem"
                  key={m.ID}
                  messageId={m.ID}
                  scrollAnchor={m.Role === "user"}
                >
                  <ConversationMessage message={m} />
                </ChatItem>
              ))}
            </ChatContent>
          </ChatViewport>
          <ChatScrollButton />
        </Conversation>
        <div className="chat-reply">
          {activity.some((row) => row.ChatID === id && row.Kind === "capture.gap") && (
            <Alert role="note" className="chat-notice">
              Some live activity could not be captured. Recovered snapshots are saved. Transient
              output may be missing.
            </Alert>
          )}
          <div className="chat-questions">{children}</div>
          <PromptInput
            onSubmit={(event) => {
              if (activeTurn || blocked || busy) {
                event.preventDefault();
                return;
              }
              onSend(event);
            }}
            className="chat-composer followup-composer"
          >
            <FieldLabel className="sr-only" htmlFor="followup-text">
              Follow-up
            </FieldLabel>
            <PromptInputTextarea
              id="followup-text"
              name="text"
              className="composer-message"
              placeholder="What’s next?"
              required
              disabled={busy || blocked}
              aria-describedby="followup-help"
            />
            <PromptInputActions className="composer-actions">
              <span className="composer-context" role="status">
                {connection} · {projectName}
              </span>
              {activeTurn && !blocked ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    onControl("interrupt");
                  }}
                >
                  Interrupt current work
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={busy || activeTurn || blocked}>
                  {busy ? "Working…" : sendLabel}
                </Button>
              )}
            </PromptInputActions>
          </PromptInput>
          <Text id="followup-help" tone="muted" size="xs" className="chat-help">
            <span>{help}</span>
            <span className="sr-only"> Up to {messageBytes.toLocaleString()} UTF-8 bytes.</span>
          </Text>
        </div>
        <dialog ref={changes} className="chat-panel" aria-label="Review changes">
          <div className="panel-heading">
            <Heading level={2}>Review changes</Heading>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                changes.current?.close();
              }}
            >
              Close
            </Button>
          </div>
          <Changes key={id} chatID={id} onExpired={onExpired} />
        </dialog>
        <dialog
          ref={diagnostics}
          className="chat-panel"
          aria-label="Activity and environment"
          onClose={() => {
            moreTrigger.current?.focus();
          }}
        >
          <div className="panel-heading">
            <Heading level={2}>Activity and environment</Heading>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                diagnostics.current?.close();
              }}
            >
              Close
            </Button>
          </div>
          <Text className="mt-4">{chat.StatusReason}</Text>
          <Text tone="muted" className="mt-3">
            Interrupt keeps the container running. Stop frees container capacity. Both preserve
            saved work and conversation.
          </Text>
          <Heading level={3} className="mt-6">
            Full activity ({activity.length} saved events)
          </Heading>
          <Text tone="muted" className="mt-3">
            Setup activity contains bounded previews.{" "}
            <Link href={`/api/chats/${encodeURIComponent(id)}/setup-log`}>
              Download the full redacted setup log
            </Link>
            .
          </Text>
          <ol className="mt-4 space-y-3">
            {activity.map((row) => (
              <li key={row.Sequence}>
                <details>
                  <summary>
                    {row.Kind} ·{" "}
                    <time dateTime={row.CreatedAt}>
                      {new Date(row.CreatedAt).toLocaleTimeString()}
                    </time>{" "}
                    · #{row.Sequence}
                  </summary>
                  <pre className="tool-output">{JSON.stringify(row.Payload, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
          <details className="mt-6">
            <summary>Environment snapshot</summary>
            <pre className="tool-output">
              {JSON.stringify(
                {
                  image: chat.ImageDigest,
                  OpenCode: chat.HarnessVersion,
                  startingCommits: chat.StartingCommits,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <details className="mt-4">
            <summary>Saved message metadata</summary>
            <pre className="tool-output">{JSON.stringify(detail.messages, null, 2)}</pre>
          </details>
        </dialog>
      </div>
    </ChatProvider>
  );
}

function ConversationMessage({ message: m }: { message: Message }) {
  const parts = m.Payload.parts ?? [];
  const failure = m.Payload.info?.error ?? null;
  const user = m.Role === "user";
  const visible = parts.filter((p) => p.type !== "step-start" && p.type !== "step-finish");
  if (!user && parts.length > 0 && visible.length === 0 && failure === null) return null;
  return (
    <MessageLayout
      align={user ? "end" : "start"}
      className={user ? "message-user" : "message-assistant"}
    >
      <MessageContent>
        <span className="sr-only">{user ? "You" : "Flora"}</span>
        {user ? (
          <Bubble className="user-bubble">{m.Text}</Bubble>
        ) : (
          <>
            {parts.length > 0 ? (
              visible.map((p, i) => <MessagePart key={p.id ?? i} part={p} />)
            ) : (
              <MarkdownMessage>{m.Text}</MarkdownMessage>
            )}
            {failure !== null && (
              <details className="tool-failed">
                <summary>
                  <span role="alert">Flora encountered an error. View details</span>
                </summary>
                <pre className="tool-output">{JSON.stringify(failure, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </MessageContent>
    </MessageLayout>
  );
}

function MessagePart({ part: p }: { part: Part }) {
  if (p.type === "text") return <MarkdownMessage>{p.text ?? ""}</MarkdownMessage>;
  if (p.type === "reasoning") {
    return (
      <Reasoning className="tool-row">
        <MarkdownMessage>{p.text ?? ""}</MarkdownMessage>
      </Reasoning>
    );
  }
  if (p.type === "tool") {
    const input = p.state?.input;
    const description =
      typeof input === "object" &&
      input !== null &&
      "description" in input &&
      typeof input.description === "string"
        ? input.description
        : "";
    const label =
      [p.state?.title, description, p.tool].find((value) => value !== undefined && value !== "") ??
      "Tool";
    const status = p.state?.status ?? "pending";
    const failed = status === "error";
    const stateLabel =
      (
        {
          error: "Failed",
          completed: "Completed",
          running: "Running",
          pending: "Pending",
        } as Record<string, string>
      )[status] ?? status;
    const traceStatus = failed ? "error" : undefined;
    return (
      <Tool className="tool-row" title={label} description={stateLabel} status={traceStatus}>
        <CodeBlock title="Input">{JSON.stringify(input ?? {}, null, 2)}</CodeBlock>
        {p.state?.output !== undefined && p.state.output !== "" && (
          <CodeBlock title="Output">{p.state.output}</CodeBlock>
        )}
        {p.state?.error !== undefined && p.state.error !== "" && (
          <div role="alert">
            <CodeBlock title="Error">{p.state.error}</CodeBlock>
          </div>
        )}
      </Tool>
    );
  }
  return (
    <details className="tool-row">
      <summary>{p.type}</summary>
      <pre className="tool-output">{JSON.stringify(p, null, 2)}</pre>
    </details>
  );
}
