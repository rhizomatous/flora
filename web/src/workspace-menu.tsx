import { useRef, useState } from "react";

import {
  SidebarMenuButton,
  FlowerMark,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton size="lg" aria-label="Workspace menu">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <FlowerMark className="text-2xl" />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block">Flora</span>
            </span>
            <ChevronUpIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </SidebarMenuButton>
        }
      />
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[var(--anchor-width)]"
        finalFocus={() => {
          const restore = !navigated.current;
          navigated.current = false;
          return restore;
        }}
      >
        <DropdownMenuItem
          render={
            <a href="#settings">
              <GearIcon aria-hidden="true" />
              Settings
            </a>
          }
          nativeButton={false}
          onClick={() => {
            navigated.current = window.location.hash !== "#settings";
          }}
        />
        <DropdownMenuItem
          render={
            <a href="#projects">
              <GearIcon aria-hidden="true" />
              Project settings
            </a>
          }
          nativeButton={false}
          onClick={() => {
            navigated.current = window.location.hash !== "#projects";
          }}
        />
        {sound && (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={audio.ready}
            onClick={(event) => {
              event.preventDefault();
              void enableSound();
            }}
          >
            <SpeakerLoudIcon aria-hidden="true" />
            {audio.ready ? "Sound enabled for this page" : "Enable notification sound"}
          </DropdownMenuItem>
        )}
        {sound && attemptedSound && !audio.ready && (
          <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
            Allow sound or autoplay in your browser, then try again. Completion toasts still appear.
            Missed sounds are not replayed.
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onClick={onLogout}>
          <ExitIcon aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
