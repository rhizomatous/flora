import { Button } from "@flora/florets";

import type { Chat } from "./chat-schemas";
import { useMarkChatsRead } from "./sidebar-status";

export function MarkChatsRead({ chats }: { chats: Chat[] | undefined }) {
  const { mark, disabled, busy } = useMarkChatsRead(chats);
  return (
    <Button variant="ghost" size="sm" disabled={disabled} aria-busy={busy} onClick={mark}>
      Mark all as read
    </Button>
  );
}

export function UnreadDot({ seen }: { seen: boolean }) {
  return seen ? null : (
    <span
      className="inline-flex shrink-0 items-center"
      role="img"
      aria-label="Unread activity"
      title="Unread activity"
    >
      <span className="size-1.5 rounded-full bg-foreground" />
    </span>
  );
}
