import { useRef, useState } from "react";

import {
  SidebarMenuButton,
  FlowerMark,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  GearIcon,
  SpeakerLoudIcon,
  ExitIcon,
  ChevronUpIcon,
} from "@flora/florets";

/** Keeps installation actions in one menu; sound activation stays inside the user's gesture. */
export function WorkspaceMenu({
  sound,
  audio,
  busy,
  onLogout,
}: {
  sound: boolean;
  audio: { ready: boolean; enable: () => Promise<void> };
  busy: boolean;
  onLogout: () => void;
}) {
  const navigated = useRef(false);
  const [attemptedSound, setAttemptedSound] = useState(false);
  async function enableSound() {
    await audio.enable();
    setAttemptedSound(true);
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" aria-label="Workspace menu">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FlowerMark />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block">Flora</span>
          </span>
          <ChevronUpIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
        onCloseAutoFocus={(event) => {
          if (navigated.current) event.preventDefault();
          navigated.current = false;
        }}
      >
        <DropdownMenuItem
          asChild
          onSelect={() => {
            navigated.current = window.location.hash !== "#settings";
          }}
        >
          <a href="#settings">
            <GearIcon aria-hidden="true" />
            Settings
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          onSelect={() => {
            navigated.current = window.location.hash !== "#projects";
          }}
        >
          <a href="#projects">
            <GearIcon aria-hidden="true" />
            Project settings
          </a>
        </DropdownMenuItem>
        {sound && (
          <DropdownMenuItem
            disabled={audio.ready}
            onSelect={(event) => {
              event.preventDefault();
              void enableSound();
            }}
          >
            <SpeakerLoudIcon aria-hidden="true" />
            {audio.ready ? "Sound enabled for this page" : "Enable notification sound"}
          </DropdownMenuItem>
        )}
        {sound && attemptedSound && !audio.ready && (
          <DropdownMenuLabel role="status">
            Allow sound or autoplay in your browser, then try again. Completion toasts still appear.
            Missed sounds are not replayed.
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={onLogout}>
          <ExitIcon aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
