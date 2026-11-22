import { useState, type SubmitEvent } from "react";

import {
  DropdownButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  InboxIcon,
  KeyRoundIcon,
  PlusIcon,
  PuzzleIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from "@flora/florets";

import { ChatBranchPicker } from "./chat-branch-picker";
import { Composer, PlaceholderMenu } from "./composer";

export type ComposerProject = { id: string; name: string };

/** Selects the saved project and submits text; unfinished controls expose their availability in menus. */
export function NewChatComposer({
  projects,
  selectedProject,
  onProjectChange,
  onBranchesChange,
  busy,
  onSend,
}: {
  projects: ComposerProject[];
  selectedProject: ComposerProject | undefined;
  onProjectChange: (id: string) => void;
  onBranchesChange: () => void;
  busy: boolean;
  onSend: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
  const [message, setMessage] = useState(() => {
    try {
      return sessionStorage.getItem(`flora-draft:new:${selectedProject?.id ?? ""}`) ?? "";
    } catch {
      return "";
    }
  });
  const [search, setSearch] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  return (
    <form
      onSubmit={onSend}
      onReset={() => {
        setMessage("");
        try {
          sessionStorage.removeItem(`flora-draft:new:${selectedProject?.id ?? ""}`);
        } catch {
          // Storage may be disabled.
        }
      }}
      className="chat-composer new-chat-composer"
    >
      <div className="composer-topbar">
        <input type="hidden" name="project" value={selectedProject?.id ?? ""} />
        <DropdownMenu
          search={{
            label: "Search projects",
            placeholder: "Search projects",
            query: search,
            onQueryChange: setSearch,
            emptyText: "No projects found.",
          }}
          open={projectOpen}
          onOpenChange={(open) => {
            setProjectOpen(open);
            if (!open) setSearch("");
          }}
        >
          <DropdownMenuTrigger
            render={
              <DropdownButton
                type="button"
                variant="tertiary"
                size="compact"
                className="composer-project max-w-[180px] min-w-0 flex-[0_1_auto] justify-start!"
                disabled={busy}
                aria-label={`Project: ${selectedProject?.name ?? ""}`}
              >
                <InboxIcon />
                <span className="florets-control-label truncate">{selectedProject?.name}</span>
              </DropdownButton>
            }
          />
          <DropdownMenuContent
            align="start"
            className="composer-menu composer-project-menu w-[260px]! max-w-[calc(100vw-24px)] gap-0 overflow-hidden p-0!"
            aria-label="Choose project"
          >
            <DropdownMenuGroup>
              {projects.map((project) => (
                <DropdownMenuItem
                  value={project.id}
                  keywords={[project.name]}
                  key={project.id}
                  data-checked={selectedProject?.id === project.id}
                  onSelect={() => {
                    onProjectChange(project.id);
                    setProjectOpen(false);
                    setSearch("");
                  }}
                >
                  <InboxIcon />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                value="new-project"
                keywords={["New project"]}
                onSelect={() => {
                  window.location.hash = "projects/new";
                }}
              >
                <PlusIcon />
                <span>New project</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                value="manage-projects"
                keywords={["Manage projects"]}
                onSelect={() => {
                  window.location.hash = "projects";
                }}
              >
                <Settings2Icon />
                <span>Manage projects</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="composer-branch ml-auto shrink-0">
          <ChatBranchPicker
            projectID={selectedProject?.id ?? ""}
            disabled={busy}
            onChange={onBranchesChange}
          />
        </div>
      </div>
      <Composer
        id="new-chat-message"
        label="Message"
        message={message}
        onChange={(value) => {
          setMessage(value);
          try {
            sessionStorage.setItem(`flora-draft:new:${selectedProject?.id ?? ""}`, value);
          } catch {
            // Storage may be disabled.
          }
        }}
        draftScope={`new:${selectedProject?.id ?? ""}`}
        projectID={selectedProject?.id ?? ""}
        disabled={busy}
        canSend={!busy}
        sendLabel={busy ? "Starting chat" : "Start chat"}
        settings={
          <PlaceholderMenu
            label="Chat settings"
            iconOnly
            items={[
              { label: "Environment variables", icon: <KeyRoundIcon /> },
              { label: "MCP servers", icon: <PuzzleIcon /> },
            ]}
          >
            <SlidersHorizontalIcon />
          </PlaceholderMenu>
        }
      />
    </form>
  );
}
