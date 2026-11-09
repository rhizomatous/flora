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
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  useSidebar,
} from "@flora/florets";

import type { Chat } from "./notifications";
import { errorMessage, isExpired, request } from "./request";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const { openMobile, setOpenMobile } = useSidebar();
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
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
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
          <div className="px-2 py-3">
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
                    All chats
                  </a>
                }
                isActive={path === "chats"}
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
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
          {chats === undefined && (
            <SidebarGroup>
              <Text tone="muted" role="status">
                Loading chats…
              </Text>
            </SidebarGroup>
          )}
          {projects.map((project) => (
            <SidebarGroup key={project.id} aria-label={project.name}>
              <SidebarGroupLabel
                render={
                  <a
                    href={`#projects/${project.id}`}
                    onClick={() => {
                      setOpenMobile(false);
                    }}
                  >
                    {project.name}
                  </a>
                }
              />
              <SidebarMenu>
                {chats
                  ?.filter((chat) => chat.ProjectID === project.id)
                  .map((chat) => (
                    <SidebarMenuItem key={chat.ID}>
                      <SidebarMenuButton
                        render={
                          <a
                            href={`#chats/${chat.ID}`}
                            title={chat.Title}
                            aria-current={path === `chats/${chat.ID}` ? "page" : undefined}
                            onClick={() => {
                              setOpenMobile(false);
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{chat.Title}</span>
                            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                              {chat.Status === "working" && <FlowerMark />}
                              {chat.Status.charAt(0).toUpperCase() + chat.Status.slice(1)}
                            </span>
                          </a>
                        }
                        isActive={path === `chats/${chat.ID}`}
                      />
                    </SidebarMenuItem>
                  ))}
                {chats !== undefined && !chats.some((chat) => chat.ProjectID === project.id) && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      render={
                        <a
                          href={`#chats/new?project=${encodeURIComponent(project.id)}`}
                          onClick={() => {
                            setOpenMobile(false);
                          }}
                        >
                          Start a chat
                        </a>
                      }
                    />
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </nav>
      <SidebarFooter>{children}</SidebarFooter>
      <SidebarRail />
    </NavigationSidebar>
  );
}
