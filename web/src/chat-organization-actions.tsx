import { useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  PinIcon,
  PencilIcon,
  ArchiveIcon,
  EllipsisIcon,
} from "@flora/florets";

import { publishOrganization } from "./chat-organization";
import { chatSchema, detailSchema, type Chat } from "./chat-schemas";
import { errorMessage, request, RequestError } from "./request";

const dialogCopy = {
  rename: { title: "Rename chat", description: "Choose a title for this chat." },
  error: { title: "Could not update chat", description: "Your saved chat is still available." },
};

export function ChatOrganizationActions({
  chat,
  label,
  quick = false,
  children,
}: {
  chat: Chat | undefined;
  label?: string;
  quick?: boolean;
  children?: ReactNode;
}) {
  const [dialog, setDialog] = useState<"rename" | "error" | null>(null);
  const [title, setTitle] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const inputID = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pinned = (chat?.PinnedAt ?? "") !== "";
  const archived = chat?.Archived === true;
  const validTitle = title.trim() !== "" && new TextEncoder().encode(title).length <= 200;
  function openRename() {
    if (!chat) return;
    setTitle(chat.Title);
    setRevision(chat.OrganizationRevision ?? 0);
    setError("");
    setDialog("rename");
  }
  async function save(
    change: { title?: string; pinned?: boolean; archived?: boolean },
    expected = chat?.OrganizationRevision ?? 0,
  ) {
    if (!chat || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await request(chatSchema, `chats/${encodeURIComponent(chat.ID)}`, {
        method: "PATCH",
        body: { ...change, revision: expected },
      });
      publishOrganization(updated);
      if (change.archived !== undefined) {
        toast.success(change.archived ? "Chat archived" : "Chat restored", {
          toasterId: "chat-organization",
        });
      }
      setDialog(null);
      requestAnimationFrame(() => {
        if (trigger.current?.isConnected !== true) document.querySelector("h1")?.focus();
      });
    } catch (cause) {
      let message = errorMessage(cause, "Could not save chat changes. Try again.");
      if (cause instanceof RequestError && cause.status === 409) {
        try {
          const fresh = await request(detailSchema, `chats/${encodeURIComponent(chat.ID)}`);
          publishOrganization(fresh.chat);
          setRevision(fresh.chat.OrganizationRevision ?? 0);
          message = "This chat changed elsewhere. Review your changes and try again.";
        } catch {
          // Keep the draft when refreshing also fails.
        }
      }
      setError(message);
      setDialog((current) => current ?? "error");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {quick && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!chat || busy || archived}
            aria-label={`${pinned ? "Unpin" : "Pin"} ${chat?.Title ?? "chat"}`}
            title={pinned ? "Unpin chat" : "Pin chat"}
            onClick={() => {
              void save({ pinned: !pinned });
            }}
          >
            <PinIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!chat || busy}
            aria-label={`${archived ? "Restore" : "Archive"} ${chat?.Title ?? "chat"}`}
            title={archived ? "Restore chat" : "Archive chat"}
            onClick={() => {
              void save({ archived: !archived });
            }}
          >
            <ArchiveIcon />
          </Button>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="ghost"
              size="icon-sm"
              disabled={!chat || busy}
              aria-busy={busy}
              aria-label={label ?? `Actions for ${chat?.Title ?? "chat"}`}
            >
              <EllipsisIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-24px)]">
          {children}
          <DropdownMenuItem
            disabled={archived}
            onClick={() => {
              void save({ pinned: !pinned });
            }}
          >
            <PinIcon />
            {pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              openRename();
            }}
          >
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              void save({ archived: !archived });
            }}
          >
            <ArchiveIcon />
            {archived ? "Restore" : "Archive"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setDialog(null);
        }}
      >
        <DialogContent
          showCloseButton={!busy}
          finalFocus={trigger}
          initialFocus={dialog === "rename" ? input : undefined}
        >
          <DialogTitle>{dialogCopy[dialog ?? "error"].title}</DialogTitle>
          <DialogDescription>{dialogCopy[dialog ?? "error"].description}</DialogDescription>
          {dialog === "rename" && (
            <form
              id={inputID}
              onSubmit={(event) => {
                event.preventDefault();
                if (validTitle) void save({ title: title.trim() }, revision);
              }}
            >
              <label htmlFor={`${inputID}-title`} className="mb-2 block text-sm">
                Chat title
              </label>
              <Input
                id={`${inputID}-title`}
                value={title}
                disabled={busy}
                aria-invalid={!validTitle}
                aria-describedby={validTitle ? undefined : `${inputID}-validation`}
                ref={input}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
              {!validTitle && (
                <p id={`${inputID}-validation`} className="mt-2 text-sm text-muted-foreground">
                  Enter a title of 1 to 200 bytes.
                </p>
              )}
            </form>
          )}
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
                setDialog(null);
              }}
            >
              {dialog === "error" ? "Close" : "Cancel"}
            </Button>
            {dialog === "rename" && (
              <Button type="submit" form={inputID} disabled={busy || !validTitle}>
                {busy ? "Saving…" : "Save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
