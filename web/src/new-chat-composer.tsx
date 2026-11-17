import { useState, type SubmitEvent } from "react";

import {
  DropdownButton,
  Popover,
  PopoverTrigger,
  PopoverContent,
  CheckIcon,
  GitBranchIcon,
  InboxIcon,
  KeyRoundIcon,
  PlusIcon,
  PuzzleIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from "@flora/florets";

import { Composer, PlaceholderMenu } from "./composer";

export type ComposerProject = { id: string; name: string };

/** Selects the saved project and submits text; unfinished controls expose their availability in menus. */
export function NewChatComposer({
  projects,
  selectedProject,
  onProjectChange,
  busy,
  onSend,
}: {
  projects: ComposerProject[];
  selectedProject: ComposerProject | undefined;
  onProjectChange: (id: string) => void;
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
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase()),
  );
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
        <Popover
          open={projectOpen}
          onOpenChange={(open) => {
            setProjectOpen(open);
            if (!open) setSearch("");
          }}
        >
          <PopoverTrigger
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
          <PopoverContent
            align="start"
            className="composer-menu composer-project-menu w-[260px]! max-w-[calc(100vw-24px)] gap-0 overflow-hidden p-0!"
            aria-label="Choose project"
          >
            <input
              className="composer-search w-full border-b border-(--overlay-border) bg-transparent px-3 py-2.5 text-[13px] outline-none"
              aria-label="Search projects"
              placeholder="Search projects"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
            <div className="composer-project-list max-h-60 overflow-y-auto p-1.5">
              {filtered.map((project) => (
                <button
                  type="button"
                  className="composer-project-option"
                  key={project.id}
                  aria-pressed={selectedProject?.id === project.id}
                  onClick={() => {
                    onProjectChange(project.id);
                    setProjectOpen(false);
                    setSearch("");
                  }}
                >
                  <InboxIcon />
                  <span className="florets-control-label truncate">{project.name}</span>
                  {selectedProject?.id === project.id && <CheckIcon className="ml-auto" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="composer-menu-note px-2.5 py-1.5 text-xs leading-normal text-muted-foreground">
                  No projects found.
                </p>
              )}
            </div>
            <div className="composer-project-links border-t border-(--overlay-border) p-1.5">
              <a href="#projects/new">
                <PlusIcon />
                <span className="florets-control-label">New project</span>
              </a>
              <a href="#projects">
                <Settings2Icon />
                <span className="florets-control-label">Manage projects</span>
              </a>
            </div>
          </PopoverContent>
        </Popover>
        <div className="composer-branch ml-auto shrink-0">
          <PlaceholderMenu
            variant="tertiary"
            label="Base branch"
            items={[{ label: "Project default branch", icon: <GitBranchIcon /> }]}
          >
            <GitBranchIcon />
            <span className="florets-control-label">Default</span>
          </PlaceholderMenu>
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
