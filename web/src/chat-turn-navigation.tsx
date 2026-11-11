import { lazy, Suspense, useState } from "react";

import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@flora/florets";

import type { TranscriptRow } from "./transcript";

const Markdown = lazy(async () => {
  const { Markdown: Component } = await import("@flora/florets/ai");
  return { default: Component };
});

/** Each user prompt starts an exchange; work rows stay with its following reply. */
function exchanges(rows: TranscriptRow[]) {
  const turns: { id: string; prompt: string; reply: string; rowIDs: string[] }[] = [];
  for (const row of rows) {
    if (row.kind !== "message") {
      turns.at(-1)?.rowIDs.push(row.id);
      continue;
    }
    const text =
      (row.message.Payload.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n") || row.message.Text;
    if (row.message.Role === "user") {
      turns.push({ id: row.id, prompt: text, reply: "", rowIDs: [row.id] });
    } else {
      const last = turns.at(-1);
      if (last) {
        last.reply = text;
        last.rowIDs.push(row.id);
      }
    }
  }
  return turns;
}

export function ChatTurnNavigation({ rows }: { rows: TranscriptRow[] }) {
  const { scrollToMessage } = useMessageScroller();
  const { visibleMessageIds } = useMessageScrollerVisibility();
  const [preview, setPreview] = useState<string | null>(null);
  const turns = exchanges(rows);
  const visible = new Set(visibleMessageIds);
  if (turns.length < 2) return null;
  return (
    <nav aria-label="Conversation turns" className="chat-turn-navigation">
      {turns.map((turn, index) => (
        <HoverCard
          key={turn.id}
          open={preview === turn.id}
          onOpenChange={(open) => {
            setPreview((current) => {
              if (open) return turn.id;
              return current === turn.id ? null : current;
            });
          }}
        >
          <HoverCardTrigger
            delay={100}
            render={
              <button
                type="button"
                className="chat-turn-marker"
                aria-label={`Turn ${index + 1}: ${turn.prompt}`}
                data-visible={turn.rowIDs.some((id) => visible.has(id)) || undefined}
                onFocus={() => {
                  setPreview(turn.id);
                }}
                onBlur={() => {
                  setPreview(null);
                }}
                onClick={() => {
                  setPreview(turn.id);
                  scrollToMessage(turn.id, {
                    align: "start",
                    behavior: "instant",
                    scrollMargin: 28,
                  });
                }}
              >
                <span />
              </button>
            }
          />
          <HoverCardContent
            side="right"
            sideOffset={8}
            density="compact"
            className="chat-turn-preview florets-menu-surface"
          >
            <p className="truncate">{turn.prompt}</p>
            {turn.reply && (
              <div className="chat-turn-reply mt-1 line-clamp-3 text-muted-foreground">
                <Suspense fallback={turn.reply}>
                  <Markdown>{turn.reply}</Markdown>
                </Suspense>
              </div>
            )}
          </HoverCardContent>
        </HoverCard>
      ))}
    </nav>
  );
}
