import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import {
  Button,
  Text,
  FlowerMark,
  Sidebar as NavigationSidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarTrigger,
  SearchIcon,
  SquarePenIcon,
  ListIcon,
  CircleDotIcon,
  GitPullRequestIcon,
  Repeat2Icon,
  CompassIcon,
  EllipsisIcon,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@flora/florets";

import type { Chat } from "./notifications";
import { errorMessage, isExpired, request } from "./request";
import { SidebarChats } from "./sidebar-chats";

type Project = { id: string; name: string };

/** Keeps project navigation beside every workspace view, using the shared live chat feed. */
export function Sidebar({
  path,
  chats,
  onExpired,
  children,
}: {
  path: string;
  chats: Chat[] | undefined;
  onExpired: () => void;
  children: ReactNode;
}) {
  const [searching, setSearching] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const { openMobile, setOpenMobile } = useSidebar();
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const openedPath = useRef<string | undefined>(undefined);
  const skipToContent = useRef(false);
  useEffect(() => {
    if (openMobile && openedPath.current === undefined) openedPath.current = path;
  }, [openMobile, path]);
  const [retry, setRetry] = useState(0);
  const expire = useEffectEvent(onExpired);
  useEffect(() => {
    setOpenMobile(false);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Route changes also dismiss navigation opened from the footer.
  }, [path, setOpenMobile]);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const rows = await request<Project[]>("projects");
        if (active) {
          setProjects(rows);
          setError("");
        }
      } catch (reason) {
        if (!active) return;
        setError(errorMessage(reason, "Could not load projects."));
        if (isExpired(reason)) expire();
      }
    }
    void load();
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Reload after project edits and explicit retries.
  }, [path, retry]);

  return (
    <NavigationSidebar
      variant="inset"
      className="flora-navigation p-0"
      mobileInitialFocus={() => mobileToggle.current}
      mobileFinalFocus={() => {
        // A destination heading may mount while the sheet still traps focus.
        const navigated = skipToContent.current || openedPath.current !== path;
        skipToContent.current = false;
        openedPath.current = undefined;
        const target = navigated
          ? document.querySelector<HTMLElement>('#main-content h1[tabindex="-1"]')
          : document.querySelector<HTMLElement>('[data-slot="sidebar-trigger"]');
        return target ?? document.querySelector<HTMLElement>("#main-content");
      }}
    >
      <nav aria-label="Main" className="flora-sidebar flex min-h-0 flex-1 flex-col">
        <SidebarHeader>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-sidebar focus:p-2"
            onClick={(event) => {
              event.preventDefault();
              skipToContent.current = openMobile;
              setOpenMobile(false);
              document.querySelector<HTMLElement>("#main-content")?.focus();
            }}
          >
            Skip to content
          </a>
          <div className="sidebar-brand-row">
            <a
              href="#chats/new"
              aria-label="Flora home"
              className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                setOpenMobile(false);
              }}
            >
              <FlowerMark className="-ml-0.5 text-2xl" />
            </a>
            <div className="ml-auto flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Search sidebar chats"
                onClick={() => {
                  setSearching(true);
                }}
              >
                <SearchIcon />
              </Button>
              <SidebarTrigger ref={mobileToggle} aria-label="Toggle Sidebar" />
            </div>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={
                  <a
                    href="#chats/new"
                    aria-current={path.startsWith("chats/new") ? "page" : undefined}
                    onClick={() => {
                      setOpenMobile(false);
                    }}
                  >
                    <SquarePenIcon />
                    New chat
                  </a>
                }
                isActive={path.startsWith("chats/new")}
              />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={
                  <a
                    href="#chats"
                    aria-current={path === "chats" ? "page" : undefined}
                    onClick={() => {
                      setOpenMobile(false);
                    }}
                  >
                    <ListIcon />
                    All chats
                  </a>
                }
                isActive={path === "chats"}
              />
            </SidebarMenuItem>
            {[
              { label: "Issues", icon: <CircleDotIcon /> },
              { label: "Pull requests", icon: <GitPullRequestIcon /> },
              { label: "Automations", icon: <Repeat2Icon /> },
              { label: "Explore", icon: <CompassIcon /> },
              { label: "More", icon: <EllipsisIcon /> },
            ].map(({ label, icon }) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton disabled title={`${label} (coming soon)`}>
                  {icon}
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="scroll-fade-y">
          {error !== "" && (
            <SidebarGroup>
              <Text size="xs" role="status">
                {error}
              </Text>
              <Button
                variant="link"
                onClick={() => {
                  setRetry(retry + 1);
                }}
              >
                Retry projects
              </Button>
            </SidebarGroup>
          )}
          <SidebarChats
            projects={projects}
            chats={chats}
            path={path}
            close={() => {
              setOpenMobile(false);
            }}
            searching={searching}
            setSearching={setSearching}
          />
        </SidebarContent>
      </nav>
      <SidebarFooter className="sidebar-account">{children}</SidebarFooter>
    </NavigationSidebar>
  );
}
