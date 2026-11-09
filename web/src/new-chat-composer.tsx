import { useState, type SubmitEvent, type ReactNode } from "react";

import {
  Button,
  ChevronDownStrokeIcon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FieldLabel,
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ArrowUpIcon,
  CheckIcon,
  CloudIcon,
  DatabaseIcon,
  FolderIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GlobeIcon,
  InboxIcon,
  KeyRoundIcon,
  MicIcon,
  PaperclipIcon,
  PinIcon,
  PlusIcon,
  PuzzleIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TagIcon,
  FlowerIcon,
  TerminalIcon,
  UsersIcon,
  FilesIcon,
  MessageSquareIcon,
} from "@flora/florets";

export type ComposerProject = { id: string; name: string };

function PlaceholderMenu({
  label,
  children,
  items,
  iconOnly = false,
}: {
  label: string;
  children: ReactNode;
  items: { label: string; icon?: ReactNode; detail?: string; separator?: boolean }[];
  iconOnly?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={`composer-control ${iconOnly ? "composer-icon" : ""}`}
          aria-label={label}
        >
          {children}
          {!iconOnly && <ChevronDownStrokeIcon className="composer-chevron" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="composer-menu" align="start">
        {items.map((item) => (
          <div key={item.label}>
            {item.separator === true && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled>
              {item.icon}
              <span className="composer-label">{item.label}</span>
              {item.detail !== undefined && (
                <span className="composer-label ml-auto text-muted-foreground">{item.detail}</span>
              )}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
    <form onSubmit={onSend} className="new-chat-composer">
      <div className="composer-topbar">
        <input type="hidden" name="project" value={selectedProject?.id ?? ""} />
        <Popover
          open={projectOpen}
          onOpenChange={(open) => {
            setProjectOpen(open);
            if (!open) setSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="composer-control composer-project"
              disabled={busy}
              aria-label={`Project: ${selectedProject?.name ?? ""}`}
            >
              <InboxIcon />
              <span className="composer-label truncate">{selectedProject?.name}</span>
              <ChevronDownStrokeIcon className="composer-chevron" />
            </Button>
          </PopoverTrigger>
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
                  <span className="composer-label truncate">{project.name}</span>
                  {selectedProject?.id === project.id && <CheckIcon className="ml-auto" />}
                </button>
              ))}
              {filtered.length === 0 && <p className="composer-menu-note">No projects found.</p>}
            </div>
            <div className="composer-project-links">
              <a href="#projects/new">
                <PlusIcon />
                <span className="composer-label">New project</span>
              </a>
              <a href="#projects">
                <Settings2Icon />
                <span className="composer-label">Manage projects</span>
              </a>
            </div>
          </PopoverContent>
        </Popover>
        <PlaceholderMenu
          label="Execution environment"
          items={[
            { label: "Cloud", icon: <CloudIcon /> },
            { label: "Machine status unavailable", icon: <DatabaseIcon /> },
          ]}
        >
          <CloudIcon />
          <span className="composer-label">Cloud</span>
        </PlaceholderMenu>
        <Button
          type="button"
          variant="ghost"
          className="composer-control"
          title="Setup assistance (coming soon)"
          aria-disabled="true"
        >
          <DatabaseIcon />
          <span className="composer-label">Setup</span>
        </Button>
        <div className="composer-branch">
          <PlaceholderMenu
            label="Base branch"
            items={[{ label: "Project default branch", icon: <GitBranchIcon /> }]}
          >
            <GitBranchIcon />
            <span className="composer-label">Default</span>
          </PlaceholderMenu>
        </div>
      </div>
      <InputGroup className="composer-box">
        <FieldLabel className="sr-only" htmlFor="new-chat-message">
          Message
        </FieldLabel>
        <InputGroupTextarea
          id="new-chat-message"
          name="text"
          className="composer-textarea"
          placeholder="Ask anything, / for commands, @ for context"
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!busy && message.trim()) event.currentTarget.form?.requestSubmit();
            }
          }}
          required
          disabled={busy}
        />
        <InputGroupAddon align="block-end" className="composer-bottom-bar">
          <PlaceholderMenu
            label="Add attachments and context"
            iconOnly
            items={[
              { label: "Upload attachment", icon: <PaperclipIcon /> },
              { label: "Environment variables", icon: <KeyRoundIcon /> },
              { label: "People", icon: <UsersIcon />, separator: true },
              { label: "Threads", icon: <MessageSquareIcon /> },
              { label: "Pull requests", icon: <GitPullRequestIcon /> },
              { label: "Skills", icon: <SparklesIcon /> },
              { label: "Files", icon: <FilesIcon /> },
            ]}
          >
            <PlusIcon />
          </PlaceholderMenu>
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
          <PlaceholderMenu
            label="Model"
            items={[{ label: "Server default model", icon: <FlowerIcon /> }]}
          >
            <span className="composer-model-mark">
              <FlowerIcon />
            </span>
            <span className="composer-label">Default model</span>
          </PlaceholderMenu>
          <PlaceholderMenu label="Reasoning effort" items={[{ label: "Default reasoning effort" }]}>
            <span className="composer-label">Default</span>
          </PlaceholderMenu>
          {message.trim() ? (
            <Button
              className="composer-send"
              type="submit"
              disabled={busy}
              aria-label={busy ? "Starting chat" : "Start chat"}
              title="Start chat"
            >
              <ArrowUpIcon />
            </Button>
          ) : (
            <Button
              className="composer-send"
              type="button"
              disabled={busy}
              aria-label="Voice input (coming soon)"
              title="Voice input (coming soon)"
              aria-disabled="true"
            >
              <MicIcon />
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
