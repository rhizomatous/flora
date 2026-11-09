import type { ReactNode } from "react";

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
  KeyRoundIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  FlowerIcon,
  UsersIcon,
  FilesIcon,
  MessageSquareIcon,
} from "@flora/florets";

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
            className={`composer-control ${iconOnly ? "composer-icon" : ""}`}
            aria-label={label}
          >
            {children}
          </TriggerButton>
        }
      />
      <DropdownMenuContent className="composer-menu" align="start" side={side}>
        {items.map((item) => (
          <div key={item.label}>
            {item.separator === true && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled>
              {item.icon}
              <span className="composer-label">{item.label}</span>
              {item.detail !== undefined && (
                <span className="composer-label ml-auto text-muted-foreground">{item.detail}</span>
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
}) {
  let action: ReactNode;
  if (onInterrupt) {
    action = (
      <Button
        variant="primary"
        size="icon-sm"
        className="composer-send"
        type="button"
        disabled={disabled}
        onClick={onInterrupt}
        aria-label="Interrupt"
        title="Interrupt work and keep the container running"
      >
        <SquareIcon />
      </Button>
    );
  } else if (message.trim() || sendLabel === "Resume" || disabled) {
    action = (
      <Button
        variant="primary"
        size="icon-sm"
        className="composer-send"
        type="submit"
        disabled={!canSend}
        aria-label={sendLabel}
        title={sendLabel}
      >
        <ArrowUpIcon />
      </Button>
    );
  } else {
    action = (
      <Button
        variant="primary"
        size="icon-sm"
        className="composer-send"
        type="button"
        aria-label="Voice input (coming soon)"
        title="Voice input (coming soon)"
        aria-disabled="true"
      >
        <MicIcon />
      </Button>
    );
  }
  return (
    <InputGroup className="composer-box">
      <FieldLabel className="sr-only" htmlFor={id}>
        {label}
      </FieldLabel>
      <InputGroupTextarea
        id={id}
        name="text"
        className="composer-textarea"
        rows={1}
        placeholder="Ask anything, / for commands, @ for context"
        value={message}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) event.currentTarget.form?.requestSubmit();
          }
        }}
        required
        disabled={disabled}
      />
      <InputGroupAddon align="block-end" className="composer-bottom-bar">
        <PlaceholderMenu
          label="Add attachments and context"
          iconOnly
          items={[
            { label: "Upload attachment", icon: <PaperclipIcon /> },
            { label: "Environment variables", icon: <KeyRoundIcon /> },
            { label: "People", icon: <UsersIcon />, separator: true },
            { label: "Threads", icon: <MessageSquareIcon /> },
            { label: "Pull requests", icon: <GitPullRequestIcon /> },
            { label: "Skills", icon: <SparklesIcon /> },
            { label: "Files", icon: <FilesIcon /> },
          ]}
        >
          <PlusIcon />
        </PlaceholderMenu>
        {settings}
        <PlaceholderMenu
          label="Model"
          items={[{ label: "Server default model", icon: <FlowerIcon /> }]}
        >
          <span className="composer-model-mark">
            <FlowerIcon />
          </span>
          <span className="composer-label">Default model</span>
        </PlaceholderMenu>
        <PlaceholderMenu label="Reasoning effort" items={[{ label: "Default reasoning effort" }]}>
          <span className="composer-label">Default</span>
        </PlaceholderMenu>
        {action}
      </InputGroupAddon>
    </InputGroup>
  );
}
