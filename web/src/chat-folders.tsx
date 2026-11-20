import { useCallback, useMemo, useEffect, useRef, useState, type ReactNode } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  NativeSelect,
  FolderIcon,
  EllipsisIcon,
  PencilIcon,
  Trash2Icon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@flora/florets";

import { publishOrganization } from "./chat-organization";
import { chatSchema, detailSchema, type Chat } from "./chat-schemas";
import {
  FolderContext,
  folderSchema,
  useFolders,
  type ChatFolder,
  type FolderDialogInput,
} from "./folder-state";
import { request, errorMessage, RequestError } from "./request";

export function FolderProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [modal, setModal] = useState<FolderDialogInput | null>(null);
  const openFolder = useCallback((input: FolderDialogInput = {}) => {
    setModal(input);
  }, []);
  const [folders, setFolders] = useState<ChatFolder[]>();
  const [error, setError] = useState("");
  const generation = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    const version = ++generation.current.value;
    const rows = await request(folderSchema.array(), "folders");
    if (generation.current.value === version) {
      setFolders(rows);
      setError("");
    }
    return rows;
  }, [generation]);
  const changed = useCallback(() => {
    generation.current.value++;
    async function reload() {
      try {
        await refresh();
      } catch {
        setError("Could not refresh folders. Retrying…");
      }
    }
    void reload();
  }, [generation, refresh]);
  useEffect(() => {
    if (!enabled) return;
    const epoch = generation.current;
    let active = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        await refresh();
      } catch {
        if (active) setError("Folders unavailable. Retrying…");
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      active = false;
      epoch.value++;
      clearInterval(timer);
      setModal(null);
      setFolders(undefined);
      setError("");
    };
  }, [enabled, refresh, generation]);
  const value = useMemo(
    () => ({ folders, error, refresh, changed, openFolder }),
    [folders, error, refresh, changed, openFolder],
  );
  return (
    <FolderContext value={value}>
      {children}
      {enabled && modal && (
        <FolderDialog
          open
          {...modal}
          onClose={() => {
            setModal(null);
          }}
        />
      )}
    </FolderContext>
  );
}

/** The same dialog creates folders from navigation and moves chats from any action menu. */
function FolderDialog({
  open,
  onClose,
  chat,
  folder,
  remove = false,
  finalFocus,
}: {
  open: boolean;
  onClose: () => void;
  chat?: Chat;
  folder?: ChatFolder;
  remove?: boolean;
  finalFocus?: React.RefObject<HTMLButtonElement | null>;
}) {
  const { folders, refresh, changed } = useFolders();
  const [name, setName] = useState(folder?.name ?? "");
  const [savedName, setSavedName] = useState(folder?.name ?? "");
  const [destination, setDestination] = useState(chat?.FolderID ?? "");
  const [revision, setRevision] = useState(folder?.revision ?? chat?.OrganizationRevision ?? 0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const creating = !remove && !folder && (!chat || destination === "__new");
  const validName =
    name.trim() !== "" &&
    new TextEncoder().encode(name.trim()).length <= 200 &&
    !/[\r\n\t]/.test(name);
  let title = "New folder";
  let submitLabel = "Create folder";
  let description = "Choose a name for this folder.";
  if (chat) {
    title = "Move chat";
    submitLabel = "Move";
    description = `Choose a folder for “${chat.Title}”.`;
  }
  if (folder) {
    title = "Rename folder";
    submitLabel = "Save";
  }
  if (remove) {
    title = "Remove folder";
    submitLabel = "Remove folder";
    description = `Remove “${savedName}”? Its chats will remain available in their projects.`;
  }
  const missing =
    folder !== undefined && folders !== undefined && !folders.some((row) => row.id === folder.id);
  const missingDestination =
    chat !== undefined &&
    destination !== "" &&
    destination !== "__new" &&
    folders !== undefined &&
    !folders.some((row) => row.id === destination);
  async function save() {
    if (
      pending.current ||
      missing ||
      missingDestination ||
      (!remove && (creating || folder !== undefined) && !validName)
    ) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    let movingChat = false;
    try {
      if (remove && folder) {
        const updated = await request(
          chatSchema.array(),
          `folders/${encodeURIComponent(folder.id)}`,
          { method: "DELETE", body: { revision } },
        );
        for (const row of updated) {
          publishOrganization(row);
        }
      } else {
        let folderID = destination;
        if (creating || folder) {
          const saved = await request(
            folderSchema,
            folder ? `folders/${encodeURIComponent(folder.id)}` : "folders",
            {
              method: folder ? "PATCH" : "POST",
              body: { name, ...(folder ? { revision } : {}) },
            },
          );
          folderID = saved.id;
          // If moving fails, keep the created folder selected so retry cannot create a duplicate.
          if (chat) setDestination(folderID);
        }
        if (chat) {
          movingChat = true;
          const updated = await request(chatSchema, `chats/${encodeURIComponent(chat.ID)}`, {
            method: "PATCH",
            body: { folderID, revision },
          });
          publishOrganization(updated);
        }
      }
      changed();
      onClose();
      requestAnimationFrame(() => {
        if (finalFocus?.current?.isConnected !== true) {
          document.querySelector<HTMLElement>("h1")?.focus();
        }
      });
    } catch (cause) {
      let message = errorMessage(cause, "Could not save folder changes. Try again.");
      if (cause instanceof RequestError && (cause.status === 409 || cause.status === 404)) {
        message = await refreshConflict(cause.status, message, movingChat);
      }
      setError(message);
      changed();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function refreshConflict(status: number, message: string, movingChat: boolean) {
    try {
      const fresh = await refresh();
      const current = fresh.find((row) => row.id === folder?.id);
      if (current) {
        setRevision(current.revision);
        setSavedName(current.name);
        if (current.revision !== revision) {
          return `This folder changed elsewhere and is now called “${current.name}”. Review your change and try again.`;
        }
      }
      if (chat && movingChat) {
        const detail = await request(detailSchema, `chats/${encodeURIComponent(chat.ID)}`);
        publishOrganization(detail.chat);
        setRevision(detail.chat.OrganizationRevision ?? 0);
        return status === 404
          ? "This folder no longer exists. Choose another folder."
          : "This chat changed elsewhere. Review the destination and try again.";
      }
    } catch {
      /* Keep the draft when refreshing also fails. */
    }
    return message;
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
        initialFocus={!chat && !remove ? input : undefined}
        showCloseButton={!busy}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          {chat && (
            <div className="space-y-2">
              <label htmlFor="chat-folder-destination" className="block text-sm font-medium">
                Folder
              </label>
              <NativeSelect
                id="chat-folder-destination"
                value={destination}
                disabled={busy || folders === undefined}
                className="w-full"
                onChange={(event) => {
                  setDestination(event.target.value);
                  setError("");
                }}
              >
                <option value="">No folder</option>
                {folders?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
                {missingDestination && (
                  <option value={destination}>Folder no longer available</option>
                )}
                <option value="__new">New folder…</option>
              </NativeSelect>
              {folders === undefined && (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading folders…
                </p>
              )}
              {missingDestination && (
                <p role="alert" className="text-sm text-destructive">
                  Choose an available folder.
                </p>
              )}
            </div>
          )}
          {!remove && (creating || folder) && (
            <div className="space-y-2">
              <label htmlFor="chat-folder-name" className="block text-sm font-medium">
                Folder name
              </label>
              <Input
                ref={input}
                id="chat-folder-name"
                value={name}
                disabled={busy || missing}
                aria-invalid={name !== "" && !validName}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
              />
              {name !== "" && !validName && (
                <p className="text-sm text-destructive">Enter 1 to 200 bytes on one line.</p>
              )}
            </div>
          )}
          {missing && (
            <p role="alert" className="text-sm text-destructive">
              This folder no longer exists.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={remove ? "destructive" : "default"}
              disabled={
                busy ||
                missing ||
                missingDestination ||
                (chat !== undefined && folders === undefined) ||
                (!remove && (creating || folder !== undefined) && !validName)
              }
            >
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FolderActions({ folder }: { folder: ChatFolder }) {
  const { openFolder } = useFolders();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={trigger}
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for folder ${folder.name}`}
          >
            <EllipsisIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            openFolder({ folder, finalFocus: trigger });
          }}
        >
          <PencilIcon />
          Rename folder
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            openFolder({ folder, remove: true, finalFocus: trigger });
          }}
        >
          <Trash2Icon />
          Remove folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NewFolderButton() {
  const { openFolder } = useFolders();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Button
      ref={trigger}
      variant="ghost"
      size="icon-sm"
      aria-label="New folder"
      onClick={() => {
        openFolder({ finalFocus: trigger });
      }}
    >
      <FolderIcon />
    </Button>
  );
}
