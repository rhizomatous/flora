import { useState } from "react";

import {
  ChevronDownIcon,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ListIcon,
  GitBranchIcon,
  XIcon,
} from "@flora/florets";

import { Changes } from "./changes";
import { ChatViewMenu, SidePanelToggle } from "./chat-controls";
import { PullList } from "./pull-links";
import type { PullSummary } from "./pull-schemas";

export function ChatSidePanel({
  chatID,
  pulls,
  onExpired,
  onClose,
}: {
  chatID: string;
  pulls: PullSummary | undefined;
  onExpired: () => void;
  onClose: () => void;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [view, setView] = useState("overview");
  return (
    <aside aria-label="Side panel" className="flex h-full min-h-0 flex-col">
      <Tabs value={view} onValueChange={setView} className="min-h-0 flex-1 gap-0">
        <div className="florets-topbar flex shrink-0 items-center gap-1 border-b px-3">
          <TabsList
            aria-label="Side panel tabs"
            className="h-auto! min-w-0 justify-start gap-1 bg-transparent p-0"
          >
            <TabsTrigger
              value="overview"
              variant="control"
              render={
                <Button variant={view === "overview" ? "secondary" : "ghost"} size="compact" />
              }
            >
              <ListIcon />
              <span className="florets-control-label">Overview</span>
            </TabsTrigger>
            {diffOpen && (
              <div className="chat-diff-tab" data-active={view === "diffs" || undefined}>
                <TabsTrigger
                  value="diffs"
                  variant="control"
                  render={
                    <Button variant="ghost" size="compact" className="chat-diff-tab-trigger" />
                  }
                >
                  <GitBranchIcon />
                  <span className="florets-control-label">Diffs</span>
                </TabsTrigger>
                <Button
                  variant="ghost"
                  size="icon-compact"
                  className="chat-diff-tab-close"
                  aria-label="Close side panel Diffs"
                  onClick={(event) => {
                    event.currentTarget
                      .closest("aside")
                      ?.querySelector<HTMLButtonElement>('[role="tab"]')
                      ?.focus();
                    setDiffOpen(false);
                    setView("overview");
                  }}
                >
                  <XIcon />
                </Button>
              </div>
            )}
          </TabsList>
          <ChatViewMenu
            label="Side panel views"
            diffsOpen={view === "diffs"}
            onDiffsChange={(open) => {
              if (open) setDiffOpen(true);
              setView(open ? "diffs" : "overview");
            }}
          />
          <span className="flex-1" />
          <SidePanelToggle open onClick={onClose} />
        </div>
        <TabsContent
          value="overview"
          keepMounted
          className="chat-view-panel min-h-0 overflow-auto p-3"
        >
          <details open>
            <summary className="overview-section-heading flex cursor-pointer items-center gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm">
              <span>Pull requests</span>
              <span className="text-muted-foreground opacity-60">{pulls?.items.length ?? 0}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className="overview-section-caret size-3 text-muted-foreground opacity-60"
              />
            </summary>
            <PullList summary={pulls} />
          </details>
        </TabsContent>
        {diffOpen && (
          <TabsContent value="diffs" keepMounted className="chat-view-panel min-h-0 min-w-0 flex-1">
            <Changes chatID={chatID} onExpired={onExpired} />
          </TabsContent>
        )}
      </Tabs>
    </aside>
  );
}
