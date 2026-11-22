import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  Button,
  SquareIcon,
  DropdownButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FieldLabel,
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  ArrowUpIcon,
  GitPullRequestIcon,
  PaperclipIcon,
  PlusIcon,
  FilesIcon,
  MessageSquareIcon,
} from "@flora/florets";

import { AttachmentPreview } from "./attachment-preview";
import {
  attachmentAccept,
  attachmentDetails,
  useAttachments,
  type AttachmentPolicy,
} from "./attachments";
import type { Execution } from "./chat-schemas";
import { ModelControls } from "./model-controls";

export function PlaceholderMenu({
  label,
  children,
  items,
  iconOnly = false,
  variant = "ghost",
  side = "bottom",
}: {
  label: string;
  children: ReactNode;
  items: { label: string; icon?: ReactNode; detail?: string; separator?: boolean }[];
  iconOnly?: boolean;
  variant?: "ghost" | "tertiary";
  side?: "top" | "bottom";
}) {
  const TriggerButton = iconOnly ? Button : DropdownButton;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <TriggerButton
            type="button"
            variant={variant}
            size={iconOnly ? "icon-compact" : "compact"}
            aria-label={label}
          >
            {children}
          </TriggerButton>
        }
      />
      <DropdownMenuContent
        className="composer-menu w-[260px]! max-w-[calc(100vw-24px)]"
        align="start"
        side={side}
      >
        {items.map((item) => (
          <div key={item.label}>
            {item.separator === true && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled>
              {item.icon}
              <span className="florets-control-label">{item.label}</span>
              {item.detail !== undefined && (
                <span className="florets-control-label ml-auto text-muted-foreground">
                  {item.detail}
                </span>
              )}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shared input and toolbar; callers own submission, drafts, and runtime controls. */
export function Composer({
  id,
  label,
  message,
  onChange,
  disabled,
  canSend,
  sendLabel,
  onInterrupt,
  settings,
  draftScope,
  projectID,
  execution,
  activeTurn = false,
}: {
  id: string;
  label: string;
  message: string;
  onChange: (value: string) => void;
  disabled: boolean;
  canSend: boolean;
  sendLabel: string;
  onInterrupt?: (() => void) | undefined;
  settings?: ReactNode;
  draftScope?: string;
  projectID?: string;
  execution?: Execution | undefined;
  activeTurn?: boolean;
}) {
  const [modelPolicy, setModelPolicy] = useState<AttachmentPolicy>();
  const attachments = useAttachments(draftScope ?? id, projectID ?? "", modelPolicy);
  const picker = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasInput = message.trim() !== "" || attachments.items.length > 0;
  const ready = canSend && attachments.ready && hasInput;
  useEffect(() => {
    const form = root.current?.closest("form");
    const reset = () => {
      attachments.clear();
    };
    form?.addEventListener("reset", reset);
    return () => {
      form?.removeEventListener("reset", reset);
    };
  });
  const action = onInterrupt ? (
    <Button
      variant="primary"
      size="icon-sm"
      className="composer-send ml-auto size-7! rounded-lg! p-0! [&_svg]:size-[15px]!"
      type="button"
      disabled={disabled}
      onClick={onInterrupt}
      aria-label="Interrupt"
      title="Interrupt work and keep the container running"
    >
      <SquareIcon />
    </Button>
  ) : (
    <Button
      variant="primary"
      size="icon-sm"
      className="composer-send ml-auto size-7! rounded-lg! p-0! [&_svg]:size-[15px]!"
      type="submit"
      disabled={!ready}
      aria-label={sendLabel}
      title={sendLabel}
    >
      <ArrowUpIcon />
    </Button>
  );
  return (
    <InputGroup
      ref={root}
      className={`composer-box ${dragging ? "ring-2 ring-ring" : ""}`}
      onDragOver={(event) => {
        if (!disabled && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (
          !(
            event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
          )
        ) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          setDragging(false);
          if (!disabled) attachments.add([...event.dataTransfer.files]);
        }
      }}
      onPaste={(event) => {
        if (!disabled && event.clipboardData.files.length > 0) {
          event.preventDefault();
          attachments.add([...event.clipboardData.files]);
        }
      }}
    >
      <input
        ref={picker}
        type="file"
        multiple
        accept={attachmentAccept}
        hidden
        tabIndex={-1}
        aria-label="Choose attachments"
        disabled={disabled}
        onChange={(event) => {
          attachments.add([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {attachments.items.map((file) => (
        <input key={file.id} type="hidden" name="attachments" value={file.id} />
      ))}
      <FieldLabel className="sr-only" htmlFor={id}>
        {label}
      </FieldLabel>
      <InputGroupTextarea
        id={id}
        name="text"
        className="composer-textarea"
        rows={1}
        placeholder={label === "Follow-up" ? "Ask a follow-up…" : "Describe a task…"}
        value={message}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (ready) event.currentTarget.form?.requestSubmit();
          }
        }}
        disabled={disabled}
      />
      {attachments.items.length > 0 && (
        <div
          className="composer-attachments flex w-full min-w-0 flex-wrap gap-1.5"
          aria-label="Draft attachments"
        >
          {attachments.items.map((file) => (
            <AttachmentPreview
              key={file.id}
              file={file}
              state={file.state}
              disabled={disabled}
              description={
                file.state === "uploading"
                  ? "Uploading…"
                  : attachments.issue(file) || attachmentDetails(file)
              }
              onRemove={() => {
                void attachments.remove(file.id);
              }}
              onRetry={
                file.state === "error" && attachments.canRetry(file.id)
                  ? () => {
                      void attachments.retry(file.id);
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
      {attachments.error !== "" && (
        <p className="w-full px-3 pt-2 text-xs text-destructive" role="alert">
          {attachments.error}
        </p>
      )}
      {attachments.items.some(
        (file) => file.state !== "uploading" && attachments.issue(file) !== "",
      ) && (
        <div className="w-full px-3 pt-2 text-xs" role="alert">
          {attachments.items
            .filter((file) => file.state !== "uploading" && attachments.issue(file) !== "")
            .map((file) => (
              <p key={file.id}>
                {file.name}: {attachments.issue(file)}
              </p>
            ))}
          {attachments.items.some(
            (file) => file.state === "done" && attachments.issue(file) !== "",
          ) && (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => {
                void attachments.checkPolicy();
              }}
            >
              Retry model check
            </Button>
          )}
        </div>
      )}
      <InputGroupAddon align="block-end" className="composer-bottom-bar">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-compact"
                aria-label="Add attachments and context"
                disabled={disabled}
              >
                <PlusIcon />
              </Button>
            }
          />
          <DropdownMenuContent
            className="composer-menu w-[260px]! max-w-[calc(100vw-24px)]"
            align="start"
            side="top"
          >
            <DropdownMenuItem
              disabled={
                attachments.items.length >= 5 || projectID === undefined || projectID === ""
              }
              onClick={() => {
                picker.current?.click();
              }}
            >
              <PaperclipIcon />
              <span className="florets-control-label">Upload attachment</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <MessageSquareIcon />
              Threads
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <GitPullRequestIcon />
              Pull requests
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <FilesIcon />
              Files
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {settings}
        <ModelControls
          key={draftScope ?? id}
          scope={draftScope ?? id}
          saved={execution}
          onPolicy={setModelPolicy}
          disabled={disabled || activeTurn}
        />
        {action}
      </InputGroupAddon>
    </InputGroup>
  );
}
