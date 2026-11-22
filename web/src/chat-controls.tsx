import { useState, type ReactNode } from "react";

import {
  TabsTrigger,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  Button,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  CloudIcon,
  GitPullRequestIcon,
  ChevronDownIcon,
  PanelRightIcon,
  ExternalLinkIcon,
  CopyIcon,
} from "@flora/florets";

import { ChatOrganizationActions } from "./chat-organization-actions";
import type { Chat, Usage, ContextUsage } from "./chat-schemas";
import { ChatSummary } from "./chat-summary";
import { ChatViewMenu } from "./chat-view-menu";
import { ContextUsagePopover } from "./context-usage";
import { PullCount, PullList } from "./pull-links";
import type { PullSummary } from "./pull-schemas";
import { RuntimeMenu, StopMachineItem } from "./runtime-controls";

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
  const titleButton = (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="compact"
      className={`chat-title inline-flex max-w-full min-w-0 shrink items-center tracking-tight ${active ? "bg-secondary! text-secondary-foreground!" : ""}`}
      aria-label={title}
      onClick={() => {
        setOpen(true);
      }}
      onFocus={() => {
        setOpen(true);
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
        className="chat-title-card chat-summary-card font-normal"
        aria-label="Chat summary"
      >
        <ChatSummary chat={chat} title={title} pulls={pulls} showPullList={false} />
      </HoverCardContent>
    </HoverCard>
  );
}

export { ChatViewMenu } from "./chat-view-menu";

export function ChatHeaderActions({
  chat,
  pulls,
  sideOpen,
  onSideToggle,
  usage,
  diffsOpen,
  onDiffsChange,
  onFilesOpen,
  filesOpen,
  overviewActive,
}: {
  chat: Chat | undefined;
  pulls: PullSummary | undefined;
  sideOpen: boolean;
  onSideToggle: () => void;
  usage: Usage | undefined;
  diffsOpen: boolean;
  onDiffsChange: (open: boolean) => void;
  onFilesOpen: () => void;
  filesOpen: boolean;
  overviewActive: boolean;
}) {
  const [copyState, setCopyState] = useState("Copy link");
  const costUnavailable = usage?.costUSD === undefined || usage.costUSD === null;
  const refreshFailed =
    usage?.collection === "history_unavailable" || usage?.collection === "runtime_stopped";
  const cost = usage?.costUSD;
  let costLabel = "Usage";
  if (cost !== undefined && cost !== null) {
    costLabel = cost > 0 && cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
  }
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
      <ChatViewMenu
        chatID={chat?.ID}
        pulls={pulls}
        diffsOpen={diffsOpen}
        onDiffsChange={onDiffsChange}
        onFilesOpen={onFilesOpen}
        filesOpen={filesOpen}
        overviewActive={overviewActive}
      />
      <span className="ml-auto" />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="compact"
              aria-label="Estimated chat cost"
              title={costUnavailable ? "Model usage" : `Estimated cost: ${costLabel}`}
            />
          }
        >
          {costLabel}
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
      <ChatOrganizationActions chat={chat} label="More chat actions">
        <DropdownMenuItem
          nativeButton={false}
          render={
            <a href={window.location.hash} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              Open in new tab
            </a>
          }
        />
        <DropdownMenuItem
          onClick={() => {
            void copyLink();
          }}
        >
          <CopyIcon />
          {copyState}
        </DropdownMenuItem>
        {chat && <StopMachineItem key={chat.ID} id={chat.ID} />}
        <DropdownMenuSeparator />
      </ChatOrganizationActions>
      {!sideOpen && <SidePanelToggle open={false} onClick={onSideToggle} />}
    </>
  );
}

/** Runtime actions use saved chat state; context uses the latest reported model call. */
export function ChatComposerFooter({
  id,
  contextUsage,
  busy,
  onControl,
}: {
  id: string;
  contextUsage: ContextUsage | undefined;
  busy: boolean;
  blocked: boolean;
  stopped: boolean;
  onControl: (action: "interrupt" | "stop") => void;
}) {
  return (
    <div className="composer-runtime flex items-center gap-1 px-2 pt-[3px] pb-1 text-muted-foreground">
      <RuntimeMenu
        key={id}
        id={id}
        onStop={() => {
          onControl("stop");
        }}
        disabled={busy}
      />
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
  const [open, setOpen] = useState(false);
  const count = pulls?.items.length ?? 0;
  return (
    <div className="composer-review flex flex-col items-center gap-1.5 pb-1.5">
      <div className="composer-accessories flex min-h-7 items-center justify-center gap-1.5">
        {children}
        {(count > 0 || (pulls?.error ?? "") !== "") && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="secondary"
                  size="sm"
                  className="composer-accessory group h-7 gap-1.5 border border-border px-2.5 text-xs [&_svg]:size-[13px]!"
                  aria-label={`Linked pull requests${pulls ? ` (${count})` : ""}`}
                >
                  {count > 0 ? <PullCount pulls={pulls?.items ?? []} /> : <GitPullRequestIcon />}
                  <ChevronDownIcon
                    className="rotate-180 text-muted-foreground group-aria-expanded:rotate-0"
                    aria-hidden="true"
                  />
                </Button>
              }
            />
            <PopoverContent
              onClickCapture={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("a[data-pr-state]") &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  setOpen(false);
                }
              }}
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
        )}
      </div>
    </div>
  );
}

export { ChatTurnNavigation } from "./chat-turn-navigation";

export { ChatPullContext as ChatPullProvider } from "./pull-context";

export function SidePanelToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={open ? "Close side panel" : "Open side panel"}
      title={open ? "Close side panel" : "Open side panel"}
      aria-expanded={open}
      onClick={onClick}
    >
      <PanelRightIcon />
    </Button>
  );
}
