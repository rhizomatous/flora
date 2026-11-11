import { useState, type SubmitEvent } from "react";

import {
  Button,
  DropdownButton,
  Popover,
  PopoverTrigger,
  PopoverContent,
  CheckIcon,
  CloudIcon,
  DatabaseIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  InboxIcon,
  KeyRoundIcon,
  PinIcon,
  PlusIcon,
  PuzzleIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TagIcon,
  TerminalIcon,
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
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <form onSubmit={onSend} className="chat-composer new-chat-composer">
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
                className="composer-project"
                disabled={busy}
                aria-label={`Project: ${selectedProject?.name ?? ""}`}
              >
                <InboxIcon />
                <span className="cn-control-label truncate">{selectedProject?.name}</span>
              </DropdownButton>
            }
          />
          <PopoverContent
            align="start"
            className="composer-menu composer-project-menu"
            aria-label="Choose project"
          >
            <input
              className="composer-search"
              aria-label="Search projects"
              placeholder="Search projects"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
            <div className="composer-project-list">
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
                  <span className="cn-control-label truncate">{project.name}</span>
                  {selectedProject?.id === project.id && <CheckIcon className="ml-auto" />}
                </button>
              ))}
              {filtered.length === 0 && <p className="composer-menu-note">No projects found.</p>}
            </div>
            <div className="composer-project-links">
              <a href="#projects/new">
                <PlusIcon />
                <span className="cn-control-label">New project</span>
              </a>
              <a href="#projects">
                <Settings2Icon />
                <span className="cn-control-label">Manage projects</span>
              </a>
            </div>
          </PopoverContent>
        </Popover>
        <PlaceholderMenu
          variant="tertiary"
          label="Execution environment"
          items={[
            { label: "Cloud", icon: <CloudIcon /> },
            { label: "Machine status unavailable", icon: <DatabaseIcon /> },
          ]}
        >
          <CloudIcon />
          <span className="cn-control-label">Cloud</span>
        </PlaceholderMenu>
        <Button
          type="button"
          variant="tertiary"
          size="compact"
          title="Setup assistance (coming soon)"
          aria-disabled="true"
        >
          <DatabaseIcon />
          <span className="cn-control-label">Setup</span>
        </Button>
        <div className="composer-branch">
          <PlaceholderMenu
            variant="tertiary"
            label="Base branch"
            items={[{ label: "Project default branch", icon: <GitBranchIcon /> }]}
          >
            <GitBranchIcon />
            <span className="cn-control-label">Default</span>
          </PlaceholderMenu>
        </div>
      </div>
      <Composer
        id="new-chat-message"
        label="Message"
        message={message}
        onChange={setMessage}
        disabled={busy}
        canSend={!busy && message.trim() !== ""}
        sendLabel={busy ? "Starting chat" : "Start chat"}
        settings={
          <PlaceholderMenu
            label="Chat settings"
            iconOnly
            items={[
              { label: "Access", icon: <GlobeIcon /> },
              { label: "Machine size", icon: <DatabaseIcon />, detail: "Default", separator: true },
              { label: "Setup and snapshots", icon: <TerminalIcon />, separator: true },
              { label: "Environment variables", icon: <KeyRoundIcon /> },
              { label: "MCP servers", icon: <PuzzleIcon /> },
              { label: "Pin", icon: <PinIcon />, separator: true },
              { label: "Folder", icon: <FolderIcon /> },
              { label: "Tags", icon: <TagIcon /> },
            ]}
          >
            <SlidersHorizontalIcon />
          </PlaceholderMenu>
        }
      />
    </form>
  );
}
