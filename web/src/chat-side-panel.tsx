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
import { useChatPanelState } from "./chat-panel-state";
import { PullList, PullStatusIcon } from "./pull-links";
import { PullOverview } from "./pull-overview";
import type { PullSummary } from "./pull-schemas";
import { SubagentConversation } from "./subagent-conversation";
import { SubagentPaneContext, subagentLabel, useSubagents } from "./subagent-state";
import { SubagentList } from "./subagents";

export function ChatSidePanel({
  chatID,
  pulls,
  onExpired,
  onClose,
  chatTitle,
}: {
  chatID: string;
  chatTitle: string;
  pulls: PullSummary | undefined;
  onExpired: () => void;
  onClose: () => void;
}) {
  const [state, update] = useChatPanelState(chatID);
  const { diffOpen } = state;
  const pullTabs = (pulls?.items ?? []).filter((pull) => state.pullTabs.includes(pull.url));
  const view =
    state.view.startsWith("pull:") && !pullTabs.some((pull) => `pull:${pull.url}` === state.view)
      ? "overview"
      : state.view;
  const { agents } = useSubagents();
  const tabs = agents.filter((agent) => state.subagentTabs.includes(agent.id));
  return (
    <SubagentPaneContext value="side">
      <aside aria-label="Side panel" className="flex h-full min-h-0 flex-col">
        <Tabs
          value={view}
          onValueChange={(value) => {
            update({ view: String(value) });
          }}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="florets-topbar flex shrink-0 items-center gap-1 border-b px-3">
            <span className="sidebar-toggle-space min-[901px]:hidden" aria-hidden="true" />
            <TabsList
              aria-label="Side panel tabs"
              className="chat-view-tabs h-auto! min-w-0 justify-start gap-1 bg-transparent p-0"
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
              {pullTabs.map((pull) => (
                <div
                  key={pull.url}
                  className="chat-diff-tab chat-pull-tab"
                  data-active={view === `pull:${pull.url}` || undefined}
                >
                  <TabsTrigger
                    value={`pull:${pull.url}`}
                    variant="control"
                    render={
                      <Button variant="ghost" size="compact" className="chat-diff-tab-trigger" />
                    }
                    data-pull-url={pull.url}
                    aria-label={`PR #${pull.number}`}
                    title={pull.repository}
                  >
                    <PullStatusIcon pull={pull} />
                    <span>#{pull.number}</span>
                  </TabsTrigger>
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    className="chat-diff-tab-close"
                    aria-label={`Close PR #${pull.number}`}
                    onClick={(event) => {
                      event.currentTarget
                        .closest("aside")
                        ?.querySelector<HTMLButtonElement>('[role="tab"]')
                        ?.focus();
                      update({
                        pullTabs: state.pullTabs.filter((url) => url !== pull.url),
                        view: view === `pull:${pull.url}` ? "overview" : view,
                      });
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
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
                      update({ diffOpen: false, view: "overview" });
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
              )}
              {tabs.map((agent) => (
                <div
                  key={agent.id}
                  className="chat-diff-tab chat-subagent-tab"
                  data-active={view === `subagent:${agent.id}` || undefined}
                >
                  <TabsTrigger
                    value={`subagent:${agent.id}`}
                    variant="control"
                    render={
                      <Button variant="ghost" size="compact" className="chat-diff-tab-trigger" />
                    }
                  >
                    {subagentLabel(agent)}
                  </TabsTrigger>
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    className="chat-diff-tab-close"
                    aria-label={`Close ${subagentLabel(agent)}`}
                    onClick={(event) => {
                      event.currentTarget
                        .closest("aside")
                        ?.querySelector<HTMLButtonElement>('[role="tab"]')
                        ?.focus();
                      update({
                        subagentTabs: state.subagentTabs.filter((id) => id !== agent.id),
                        view: view === `subagent:${agent.id}` ? "overview" : view,
                      });
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
            </TabsList>
            <ChatViewMenu
              pulls={pulls}
              chatID={chatID}
              onFilesOpen={() => {
                update({
                  open: state.open && !window.matchMedia("(max-width: 900px)").matches,
                  filesOpen: true,
                  mainView: "files",
                });
                requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLButtonElement>(
                      '.chat-main-pane [data-workspace-view="files"]',
                    )
                    ?.focus();
                });
              }}
              label="Side panel views"
              overviewActive={view === "overview"}
              diffsOpen={view === "diffs"}
              onDiffsChange={(open) => {
                update({ diffOpen: open || diffOpen, view: open ? "diffs" : "overview" });
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
            <details
              open={state.pullsOpen}
              onToggle={(event) => {
                if (event.currentTarget.open !== state.pullsOpen) {
                  update({ pullsOpen: event.currentTarget.open });
                }
              }}
            >
              <summary className="overview-section-heading flex cursor-pointer items-center gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm">
                <span>Pull requests</span>
                <span className="text-muted-foreground opacity-60">{pulls?.items.length ?? 0}</span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className="overview-section-caret size-3 text-muted-foreground opacity-60"
                />
              </summary>
              <PullList summary={pulls} chatID={chatID} />
            </details>
            <SubagentList />
          </TabsContent>
          {pullTabs.map((pull) => (
            <TabsContent
              key={pull.url}
              value={`pull:${pull.url}`}
              keepMounted
              className="chat-view-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              <PullOverview
                pull={pull}
                chatID={chatID}
                chatTitle={chatTitle}
                error={pulls?.error ?? ""}
              />
            </TabsContent>
          ))}
          {diffOpen && (
            <TabsContent
              value="diffs"
              keepMounted
              className="chat-view-panel min-h-0 min-w-0 flex-1"
            >
              <Changes chatID={chatID} onExpired={onExpired} />
            </TabsContent>
          )}
          {tabs.map((agent) => (
            <TabsContent
              key={agent.id}
              value={`subagent:${agent.id}`}
              keepMounted
              className="chat-view-panel min-h-0 min-w-0 flex-1"
            >
              <SubagentConversation agent={agent} onExpired={onExpired} />
            </TabsContent>
          ))}
        </Tabs>
      </aside>
    </SubagentPaneContext>
  );
}
