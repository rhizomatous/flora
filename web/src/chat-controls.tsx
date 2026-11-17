import { useEffect, useState, type ReactNode } from "react";

import {
  TabsTrigger,
  PencilIcon,
  ArchiveIcon,
  Trash2Icon,
  PinIcon,
  FolderIcon,
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
  PlusIcon,
  TerminalIcon,
  MonitorIcon,
  ClockIcon,
  EllipsisIcon,
  PanelRightIcon,
  ExternalLinkIcon,
  CopyIcon,
  FilesIcon,
  GlobeIcon,
  ListIcon,
} from "@flora/florets";

import type { Chat, Usage, ContextUsage } from "./chat-schemas";
import { chatStatus } from "./chat-status";
import { ContextUsagePopover } from "./context-usage";
import { PullCount, PullList } from "./pull-links";
import type { PullSummary } from "./pull-schemas";

/** Shows saved chat metadata and linked pull requests. */
export function ChatTitle({
  title,
  chat,
  pulls,
  tabbed = false,
  active = true,
}: {
  tabbed?: boolean;
  active?: boolean;
  title: string;
  chat: Chat | undefined;
  pulls: PullSummary | undefined;
}) {
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
  const titleButton = (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="compact"
      className={`chat-title inline-flex max-w-full min-w-0 shrink items-center tracking-tight ${active ? "bg-secondary! text-secondary-foreground!" : ""}`}
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
  );
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
          tabbed ? <TabsTrigger value="chat" variant="control" render={titleButton} /> : titleButton
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
          <span title={chat?.StatusReason}>{chat ? chatStatus(chat).label : "Loading"}</span>
          <time dateTime={chat?.UpdatedAt} title={updated?.toLocaleString()}>
            {ageLabel}
          </time>
          <PullCount pulls={pulls?.items ?? []} />
        </div>
        <div className="mt-2 border-t border-border pt-2">
          <PullList summary={pulls} />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function ChatViewMenu({
  label = "Chat views",
  diffsOpen,
  onDiffsChange,
}: {
  label?: string;
  diffsOpen: boolean;
  onDiffsChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            <PlusIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-24px)]">
        <DropdownMenuItem
          onClick={() => {
            onDiffsChange(false);
          }}
        >
          <ListIcon />
          Overview
          {!diffsOpen && (
            <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
              Current view
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onDiffsChange(true);
          }}
        >
          <GitBranchIcon />
          Diffs
          {diffsOpen && (
            <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">Open</span>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <FilesIcon />
          Machine files
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <DatabaseIcon />
          Setup
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <GlobeIcon />
          Browser
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Side threads</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <TerminalIcon />
          New shell
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <MonitorIcon />
          Desktop
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <ClockIcon />
          Keep awake 4h
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatHeaderActions({
  sideOpen,
  onSideToggle,
  usage,
  diffsOpen,
  onDiffsChange,
}: {
  sideOpen: boolean;
  onSideToggle: () => void;
  usage: Usage | undefined;
  diffsOpen: boolean;
  onDiffsChange: (open: boolean) => void;
}) {
  const [copyState, setCopyState] = useState("Copy link");
  const costUnavailable = usage?.costUSD === undefined || usage.costUSD === null;
  const refreshFailed =
    usage?.collection === "history_unavailable" || usage?.collection === "runtime_stopped";
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
      <ChatViewMenu diffsOpen={diffsOpen} onDiffsChange={onDiffsChange} />
      <span className="ml-auto" />
      <Popover>
        <PopoverTrigger
          render={<Button variant="ghost" size="compact" aria-label="Estimated chat cost" />}
        >
          {usage?.costUSD === undefined || usage.costUSD === null
            ? "Cost —"
            : `Est. ${usage.costUSD > 0 && usage.costUSD < 0.01 ? "<$0.01" : `$${usage.costUSD.toFixed(2)}`}`}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <PopoverTitle className="text-base font-semibold">Model usage</PopoverTitle>
          {refreshFailed && (
            <PopoverDescription>
              {usage.steps > 0
                ? "Showing saved usage. Couldn’t refresh."
                : "Couldn’t refresh usage."}
            </PopoverDescription>
          )}
          {!refreshFailed && costUnavailable && (
            <PopoverDescription>No usage yet.</PopoverDescription>
          )}
          {usage && usage.steps > 0 && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {(
                [
                  ["Input tokens", usage.input],
                  ["Output tokens", usage.output],
                  ["Reasoning tokens", usage.reasoning],
                  ["Cache read", usage.cacheRead],
                  ["Cache write", usage.cacheWrite],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt>{label}</dt>
                  <dd className="text-right tabular-nums">{value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          )}
        </PopoverContent>
      </Popover>
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
            { label: "Rename", icon: <PencilIcon /> },
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
          <DropdownMenuSeparator />
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
        aria-label={sideOpen ? "Close side panel" : "Open side panel"}
        title={sideOpen ? "Close side panel" : "Open side panel"}
        aria-expanded={sideOpen}
        onClick={onSideToggle}
      >
        <PanelRightIcon />
      </Button>
    </>
  );
}

/** Runtime actions use saved chat state; context uses the latest reported model call. */
export function ChatComposerFooter({
  contextUsage,
  busy,
  blocked,
  stopped,
  onControl,
}: {
  contextUsage: ContextUsage | undefined;
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
      <ContextUsagePopover usage={contextUsage} />
    </div>
  );
}

export function ChatReviewStrip({
  children,
  pulls,
}: {
  children: ReactNode;
  pulls: PullSummary | undefined;
}) {
  const count = pulls?.items.length ?? 0;
  return (
    <div className="composer-review flex flex-col items-center gap-1.5 pb-1.5">
      <div className="composer-accessories flex min-h-7 items-center justify-center gap-1.5">
        {children}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="secondary"
                size="sm"
                className="composer-accessory h-7 gap-1.5 border border-border px-2.5 text-xs [&_svg]:size-[13px]!"
                aria-label={`Linked pull requests${pulls ? ` (${count})` : ""}`}
              >
                {count > 0 ? <PullCount pulls={pulls?.items ?? []} /> : <GitPullRequestIcon />}
                <span>Linked PRs</span>
              </Button>
            }
          />
          <PopoverContent
            side="top"
            align="center"
            density="compact"
            className="max-h-[50dvh] w-96! max-w-[calc(100vw-24px)]! overflow-y-auto"
          >
            <PopoverTitle>Linked pull requests</PopoverTitle>
            <PopoverDescription className="sr-only">
              Saved GitHub pull requests for this chat.
            </PopoverDescription>
            <PullList summary={pulls} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export { ChatTurnNavigation } from "./chat-turn-navigation";

export { ChatPullContext as ChatPullProvider } from "./pull-context";
