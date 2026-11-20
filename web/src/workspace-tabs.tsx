import { useEffect } from "react";

import { Button, TabsContent, TabsTrigger, FilesIcon, FileTypeIcon, XIcon } from "@flora/florets";

import { useChatPanelState, workspaceFileView } from "./chat-panel-state";
import { ShellTabs, ShellPanels } from "./shells";
import { WorkspaceFiles } from "./workspace-files";
import { WorkspacePreview } from "./workspace-preview";

function focusSelected() {
  requestAnimationFrame(() => {
    const selected =
      document.querySelector<HTMLButtonElement>('.chat-main-pane [role="tab"][data-active]') ??
      document.querySelector<HTMLButtonElement>(".chat-main-pane .chat-title");
    selected?.focus();
  });
}

export function WorkspaceTabs({ chatID }: { chatID: string }) {
  const [state, update] = useChatPanelState(chatID);
  useEffect(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>('.chat-main-pane [role="tab"]')];
    const selected = tabs.find((tab) => tab.dataset.workspaceView === state.mainView);
    const list = selected?.closest('[role="tablist"]');
    if (!selected || !list) return;
    const reveal = () => {
      selected.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [state.mainView]);
  return (
    <>
      <ShellTabs chatID={chatID} />
      {state.filesOpen && (
        <div
          className="chat-diff-tab workspace-tab"
          data-active={state.mainView === "files" || undefined}
        >
          <TabsTrigger
            value="files"
            data-workspace-view="files"
            variant="control"
            render={<Button variant="ghost" size="compact" className="chat-diff-tab-trigger" />}
          >
            <FilesIcon />
            <span className="florets-control-label">Files</span>
          </TabsTrigger>
          <Button
            variant="ghost"
            size="icon-compact"
            className="chat-diff-tab-close"
            aria-label="Close Files"
            onClick={() => {
              update({
                filesOpen: false,
                mainView: state.mainView === "files" ? "chat" : state.mainView,
              });
              focusSelected();
            }}
          >
            <XIcon />
          </Button>
        </div>
      )}
      {state.workspaceTabs.map((file) => {
        const view = workspaceFileView(file);
        const basename = file.path.split("/").at(-1);
        const ambiguous =
          state.workspaceTabs.filter((tab) => tab.path.split("/").at(-1) === basename).length > 1;
        return (
          <div
            key={view}
            className="chat-diff-tab workspace-tab"
            data-active={state.mainView === view || undefined}
          >
            <TabsTrigger
              value={view}
              data-workspace-view={view}
              variant="control"
              aria-label={`${file.repository}/${file.path}`}
              title={`${file.repository}/${file.path}`}
              render={
                <Button variant="ghost" size="compact" className="chat-diff-tab-trigger max-w-56" />
              }
            >
              <FileTypeIcon path={file.path} />
              <span className="florets-control-label truncate">
                {basename}
                {ambiguous && (
                  <span className="ml-1 text-muted-foreground">· {file.repository}</span>
                )}
              </span>
            </TabsTrigger>
            <Button
              variant="ghost"
              size="icon-compact"
              className="chat-diff-tab-close"
              aria-label={`Close ${file.repository}/${file.path}`}
              onClick={() => {
                const tabs = state.workspaceTabs.filter((tab) => workspaceFileView(tab) !== view);
                const next = state.filesOpen ? "files" : "chat";
                update({
                  workspaceTabs: tabs,
                  mainView: state.mainView === view ? next : state.mainView,
                });
                focusSelected();
              }}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
    </>
  );
}

export function WorkspacePanels({ chatID, onExpired }: { chatID: string; onExpired: () => void }) {
  const [state] = useChatPanelState(chatID);
  return (
    <>
      <ShellPanels chatID={chatID} onExpired={onExpired} />
      {state.filesOpen && (
        <TabsContent
          value="files"
          keepMounted
          className="chat-view-panel -mx-4 min-h-0 min-w-0 flex-1 sm:-mx-8"
        >
          <WorkspaceFiles
            chatID={chatID}
            active={state.mainView === "files"}
            onExpired={onExpired}
          />
        </TabsContent>
      )}
      {state.workspaceTabs.map((file) => {
        const view = workspaceFileView(file);
        return (
          <TabsContent
            key={view}
            value={view}
            keepMounted
            className="chat-view-panel -mx-4 min-h-0 min-w-0 flex-1 sm:-mx-8"
          >
            <WorkspacePreview
              chatID={chatID}
              file={file}
              active={state.mainView === view}
              onExpired={onExpired}
            />
          </TabsContent>
        );
      })}
    </>
  );
}
