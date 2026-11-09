import { useState, type ReactNode } from "react";

import {
  Share2Icon,
  CrownIcon,
  PencilIcon,
  RefreshCwIcon,
  GitForkIcon,
  HashIcon,
  MailIcon,
  ArchiveIcon,
  Trash2Icon,
  PinIcon,
  FolderIcon,
  TagIcon,
  Button,
  DropdownButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Popover,
  PopoverTrigger,
  PopoverContent,
  CloudIcon,
  DatabaseIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  TerminalIcon,
  PlusIcon,
  EllipsisIcon,
  PanelRightIcon,
  ExternalLinkIcon,
  CopyIcon,
  FilesIcon,
  GlobeIcon,
  ListIcon,
  MonitorIcon,
  ClockIcon,
  ChevronUpIcon,
} from "@flora/florets";

import { PlaceholderMenu } from "./composer";

export function ChatViewMenu({ title }: { title: string }) {
  return (
    <PlaceholderMenu
      label="Chat views"
      items={[
        { label: "Overview", icon: <ListIcon />, detail: "Current view" },
        { label: "Diffs", icon: <GitBranchIcon /> },
        { label: "Machine files", icon: <FilesIcon /> },
        { label: "Setup", icon: <DatabaseIcon /> },
        { label: "Browser", icon: <GlobeIcon /> },
        { label: "Side threads", separator: true },
        { label: "New shell", icon: <TerminalIcon />, separator: true },
        { label: "Desktop", icon: <MonitorIcon /> },
        { label: "Keep awake 4h", icon: <ClockIcon />, separator: true },
      ]}
    >
      <CloudIcon />
      <span className="composer-label truncate">{title}</span>
    </PlaceholderMenu>
  );
}

export function ChatHeaderActions() {
  const [copyState, setCopyState] = useState("Copy link");
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("Link copied");
    } catch {
      setCopyState("Could not copy link");
    }
  }
  return (
    <>
      <Button
        render={<a href="#chats/new" aria-label="New chat" />}
        nativeButton={false}
        role="link"
        variant="tertiary"
        size="icon-sm"
        aria-label="New chat"
      >
        <PlusIcon />
      </Button>
      <span className="ml-auto" />
      <Button
        variant="tertiary"
        className="composer-control"
        aria-disabled="true"
        title="Cost tracking is not available yet"
      >
        Cost —
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="tertiary" size="icon-sm" aria-label="More chat actions">
              <EllipsisIcon />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          className="composer-menu max-h-[70dvh] overflow-y-auto [&_[role=menuitem]]:whitespace-nowrap"
        >
          <DropdownMenuItem disabled>
            <Share2Icon />
            Share
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a href={window.location.hash} target="_blank" rel="noreferrer">
                <ExternalLinkIcon />
                Open in new tab
              </a>
            }
            nativeButton={false}
          />
          {[
            { label: "Pin", icon: <PinIcon /> },
            { label: "Move to", icon: <FolderIcon /> },
            { label: "Tags", icon: <TagIcon /> },
            { label: "Promote to Captain", icon: <CrownIcon /> },
            { label: "Rename", icon: <PencilIcon /> },
            { label: "Regenerate title", icon: <RefreshCwIcon /> },
          ].map(({ label, icon }) => (
            <DropdownMenuItem key={label} disabled>
              {icon}
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => {
              void copyLink();
            }}
          >
            <CopyIcon />
            {copyState}
          </DropdownMenuItem>
          {[
            { label: "Fork", icon: <GitForkIcon /> },
            { label: "Device access", icon: <MonitorIcon /> },
            { label: "Slack", icon: <HashIcon /> },
            { label: "Make an automation", icon: <ClockIcon /> },
          ].map(({ label, icon }) => (
            <DropdownMenuItem key={label} disabled>
              {icon}
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <MailIcon />
            Mark as unread
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <ArchiveIcon />
            Archive
          </DropdownMenuItem>
          <DropdownMenuItem disabled variant="destructive">
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="tertiary"
        size="icon-sm"
        aria-label="Split review (coming soon)"
        title="Split review (coming soon)"
        aria-disabled="true"
      >
        <PanelRightIcon />
      </Button>
    </>
  );
}

/** Runtime actions use the saved chat state; machine telemetry and context usage are unavailable. */
export function ChatComposerFooter({
  busy,
  blocked,
  stopped,
  onControl,
}: {
  busy: boolean;
  blocked: boolean;
  stopped: boolean;
  onControl: (action: "interrupt" | "stop") => void;
}) {
  return (
    <div className="composer-runtime">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <DropdownButton
              variant="tertiary"
              className="composer-control composer-up"
              aria-label="Chat actions"
            >
              <CloudIcon />
              <span className="composer-label">Cloud</span>
              <span className="runtime-dot" />
            </DropdownButton>
          }
        />
        <DropdownMenuContent side="top" align="start" className="composer-menu">
          <p className="composer-menu-note">Machine details unavailable</p>
          <DropdownMenuItem disabled>
            <DatabaseIcon />
            Machine size
          </DropdownMenuItem>
          <DropdownMenuItem disabled>Wake machine</DropdownMenuItem>
          {!blocked && !stopped && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy}
                onClick={() => {
                  onControl("stop");
                }}
              >
                Stop container
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="composer-context"
              aria-label="Context usage"
              title="Context usage"
            >
              <span className="context-ring" />
            </Button>
          }
        />
        <PopoverContent side="top" align="end" className="composer-menu">
          <div className="flex justify-between text-sm">
            <strong>Context</strong>
            <span className="text-muted-foreground">Unavailable</span>
          </div>
          <div className="my-2 h-1.5 rounded-full bg-muted" />
          {[
            "System prompt",
            "Native tools",
            "Rules",
            "Codemode catalog",
            "Environment",
            "Conversation",
          ].map((label) => (
            <div key={label} className="context-row">
              <span>{label}</span>
              <span>—</span>
            </div>
          ))}
          <Button variant="secondary" className="mt-3 w-full justify-between" disabled>
            Compact at<span>—</span>
          </Button>
          <p className="composer-menu-note">
            Token usage and compaction controls are not connected yet.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ChatReviewStrip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="composer-review">
      <div className="composer-accessories">
        {children}
        <Button
          variant="secondary"
          size="sm"
          className="composer-accessory"
          aria-label="Pull requests and terminals"
          aria-expanded={open}
          aria-controls="chat-review-details"
          onClick={() => {
            setOpen(!open);
          }}
        >
          <TerminalIcon />
          <span className="sr-only">Terminals</span>
          <GitPullRequestIcon />
          <span>PRs</span>
          <ChevronUpIcon className={open ? "rotate-180" : ""} />
        </Button>
      </div>
      {open && (
        <div id="chat-review-details" className="composer-review-details">
          <div className="flex items-center gap-2">
            <GitPullRequestIcon className="size-4" />
            <span>Pull request details unavailable</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {["Review changes", "Checks", "Open pull request", "Terminals"].map((label) => (
              <Button key={label} variant="secondary" size="sm" disabled>
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
