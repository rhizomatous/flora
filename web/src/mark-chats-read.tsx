import { useRef, useState, type ReactElement, type RefObject } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  NativeSelect,
} from "@flora/florets";

import type { Chat } from "./chat-schemas";
import { errorMessage } from "./request";
import { markChatsRead } from "./sidebar-status";

type Scope = "visible" | "current" | "archived" | "all";

export function MarkChatsRead({
  chats,
  visible,
  children,
}: {
  chats: Chat[] | undefined;
  visible?: Chat[];
  children: (
    open: () => void,
    disabled: boolean,
    trigger: RefObject<HTMLButtonElement | null>,
  ) => ReactElement;
}) {
  const [snapshot, setSnapshot] = useState<{ all: Chat[]; visible?: Chat[] }>();
  const [scope, setScope] = useState<Scope>(visible ? "visible" : "current");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const selected =
    scope === "visible"
      ? (snapshot?.visible ?? [])
      : (snapshot?.all ?? []).filter(
          (chat) => scope === "all" || (chat.Archived === true) === (scope === "archived"),
        );
  const unread = selected.filter(
    (chat) => (chat.LastViewedRevision ?? 0) < (chat.ActivityRevision ?? 0),
  );
  async function save() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await markChatsRead(unread);
      setSnapshot(undefined);
    } catch (cause) {
      setError(errorMessage(cause, "Could not save read state. Try again."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {children(
        () => {
          setSnapshot({ all: [...(chats ?? [])], ...(visible ? { visible: [...visible] } : {}) });
          setScope(visible ? "visible" : "current");
          setError("");
        },
        chats === undefined,
        trigger,
      )}
      <Dialog
        open={snapshot !== undefined}
        onOpenChange={(open) => {
          if (!open && !busy) setSnapshot(undefined);
        }}
      >
        <DialogContent showCloseButton={!busy} finalFocus={trigger}>
          <DialogTitle>Mark all as read</DialogTitle>
          <DialogDescription>
            Choose which chats to mark as read. New activity stays unread.
          </DialogDescription>
          <label className="grid gap-2 text-sm">
            Scope
            <NativeSelect
              aria-label="Read scope"
              value={scope}
              disabled={busy}
              onChange={(event) => {
                const { value } = event.target;
                if (
                  value === "visible" ||
                  value === "current" ||
                  value === "archived" ||
                  value === "all"
                ) {
                  setScope(value);
                }
              }}
            >
              {snapshot?.visible && <option value="visible">Matching chats in this view</option>}
              <option value="current">Current chats in all projects</option>
              <option value="archived">Archived chats in all projects</option>
              <option value="all">All chats, including archives</option>
            </NativeSelect>
          </label>
          <p className="text-sm text-muted-foreground" role="status">
            {unread.length === 0
              ? "No unread chats in this scope."
              : `${unread.length} ${unread.length === 1 ? "chat" : "chats"} with unread activity.`}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSnapshot(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || unread.length === 0}
              aria-busy={busy}
              onClick={() => {
                void save();
              }}
            >
              {busy ? "Saving…" : "Mark as read"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
