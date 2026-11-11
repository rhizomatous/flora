import { useEffect, useState, type ReactNode } from "react";

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
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  FlowerIcon,
  Button,
  PlayIcon,
  SquareIcon,
  DropdownButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
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
import type { Chat } from "./notifications";

/** Summarizes saved chat metadata; unavailable model and PR data stay explicitly unknown. */
export function ChatTitle({ title, chat }: { title: string; chat: Chat | undefined }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [open]);
  const updated = chat ? new Date(chat.UpdatedAt) : undefined;
  const age = updated ? Math.max(0, now - updated.getTime()) : Number.NaN;
  let ageLabel = "Unavailable";
  if (Number.isFinite(age)) {
    let unit: "day" | "hour" | "minute" = "minute";
    if (age >= 86_400_000) unit = "day";
    else if (age >= 3_600_000) unit = "hour";
    const divisor = { day: 86_400_000, hour: 3_600_000, minute: 60_000 }[unit];
    ageLabel =
      age < 60_000
        ? "Just now"
        : new Intl.RelativeTimeFormat(undefined, { numeric: "always" }).format(
            -Math.floor(age / divisor),
            unit,
          );
  }
  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setNow(Date.now());
      }}
    >
      <HoverCardTrigger
        delay={200}
        render={
          <Button
            variant="secondary"
            size="compact"
            className="chat-title inline-flex max-w-full items-center bg-secondary! text-secondary-foreground!"
            aria-label={title}
            onClick={() => {
              setOpen(true);
              setNow(Date.now());
            }}
            onFocus={() => {
              setOpen(true);
              setNow(Date.now());
            }}
          >
            <CloudIcon />
            <span className="florets-control-label truncate">{title}</span>
          </Button>
        }
      />
      <HoverCardContent
        align="start"
        alignOffset={0}
        density="compact"
        className="chat-title-card florets-menu-surface font-normal"
        aria-label="Chat summary"
      >
        <div className="chat-summary-meta flex items-center justify-between gap-3 text-muted-foreground">
          <span className="truncate" title={chat?.ID}>
            {chat?.ID ?? "—"}
          </span>
          <span
            className="chat-summary-model flex shrink-0 items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5"
            title="Model details unavailable"
          >
            <FlowerIcon />
            Model —
          </span>
        </div>
        <p className="chat-summary-title mt-[3px] wrap-anywhere">{title}</p>
        <div className="chat-summary-footer mt-2.5 flex items-center gap-4 border-t border-border pt-2.5 text-muted-foreground">
          <span>
            {chat ? chat.Status.charAt(0).toUpperCase() + chat.Status.slice(1) : "Loading"}
          </span>
          <time dateTime={chat?.UpdatedAt} title={updated?.toLocaleString()}>
            {ageLabel}
          </time>
          <span
            className="chat-summary-pr flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5"
            aria-label="Pull request count unavailable"
            title="Pull request count unavailable"
          >
            <GitPullRequestIcon />—
          </span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function ChatViewMenu() {
  return (
    <PlaceholderMenu
      label="Chat views"
      iconOnly
      variant="ghost"
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
      <PlusIcon />
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
      <ChatViewMenu />
      <span className="ml-auto" />
      <Button
        variant="ghost"
        size="compact"
        aria-disabled="true"
        title="Cost tracking is not available yet"
      >
        Cost —
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="More chat actions">
              <EllipsisIcon />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          className="composer-menu max-h-[70dvh] w-[260px]! max-w-[calc(100vw-24px)] overflow-y-auto [&_[role=menuitem]]:whitespace-nowrap"
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
        variant="ghost"
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
    <div className="composer-runtime flex items-center gap-1 px-2 pt-[3px] pb-1 text-muted-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <DropdownButton
              variant="tertiary"
              size="compact"
              className="composer-up [&_[data-slot=dropdown-chevron]]:rotate-180"
              aria-label="Chat actions"
            >
              <CloudIcon />
              <span className="florets-control-label">Cloud</span>
              <span className="runtime-dot size-[5px] rounded-full bg-muted-foreground" />
            </DropdownButton>
          }
        />
        <DropdownMenuContent
          side="top"
          align="start"
          className="cloud-menu w-72! max-w-[calc(100vw-24px)] p-1.5 text-[13px]"
        >
          <div className="cloud-machine-summary px-1.5 pt-[5px] pb-1.5 leading-5">
            <div className="cloud-machine-heading flex items-center justify-between gap-3">
              <span>Cloud machine</span>
              <span className="cloud-machine-status flex items-center gap-1.5 text-muted-foreground">
                <span className="runtime-dot size-[5px] rounded-full bg-muted-foreground" />
                Unknown
              </span>
            </div>
            <p
              className="cloud-machine-specs text-muted-foreground"
              aria-label="CPU, memory, and disk details unavailable"
            >
              CPU — · Memory — · Disk —
            </p>
          </div>
          <DropdownMenuItem disabled>
            <PlayIcon />
            Wake machine
          </DropdownMenuItem>
          {!blocked && !stopped && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy}
                onClick={() => {
                  onControl("stop");
                }}
              >
                <SquareIcon />
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
              className="composer-context ml-auto size-7!"
              aria-label="Context usage"
              title="Context usage"
            >
              <span className="context-ring size-3.5 rounded-full border-2 border-border border-t-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent side="top" align="end" density="compact" className="context-popover gap-0">
          <div className="context-header flex items-center justify-between gap-3">
            <PopoverTitle>Context</PopoverTitle>
            <span className="context-value text-muted-foreground tabular-nums">Unavailable</span>
          </div>
          <PopoverDescription className="sr-only">
            Token usage and compaction controls are not connected yet.
          </PopoverDescription>
          <div
            className="context-meter mt-3 mb-2.5 h-1.5 rounded-full bg-border"
            aria-hidden="true"
          />
          <dl className="context-breakdown">
            {[
              { label: "System prompt", color: "#808080" },
              { label: "Native tools", color: "#8b5cf6" },
              { label: "Rules", color: "#10b981" },
              { label: "Codemode catalog", color: "#ec4899" },
              { label: "Environment", color: "#0099ff" },
              { label: "Conversation", color: "var(--action)" },
            ].map(({ label, color }) => (
              <div
                key={label}
                className="context-row flex min-h-[22px] items-center justify-between gap-3 [&_dt]:flex [&_dt]:items-center [&_dt]:gap-2"
              >
                <dt>
                  <span
                    className="context-swatch size-2 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  {label}
                </dt>
                <dd
                  className="context-value text-muted-foreground tabular-nums"
                  aria-label="Unavailable"
                >
                  —
                </dd>
              </div>
            ))}
          </dl>
          <Button
            variant="outline"
            className="context-compaction mt-3 h-7 w-full justify-between px-2 text-[length:inherit] font-normal disabled:opacity-100"
            disabled
          >
            <span>Compact at</span>
            <span className="context-value text-muted-foreground tabular-nums">— / —</span>
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ChatReviewStrip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="composer-review flex flex-col items-center gap-1.5 pb-1.5">
      <div className="composer-accessories flex min-h-7 items-center justify-center gap-1.5">
        {children}
        <Button
          variant="secondary"
          size="sm"
          className="composer-accessory h-7 gap-1.5 border border-border px-2.5 text-xs [&_svg]:size-[13px]!"
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
        <div
          id="chat-review-details"
          className="composer-review-details w-full rounded-[10px] bg-muted px-4 py-3 text-[13px] text-muted-foreground"
        >
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

export { ChatTurnNavigation } from "./chat-turn-navigation";
