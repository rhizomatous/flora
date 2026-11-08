import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import {
  Button,
  Text,
  Wordmark,
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
  const { setOpenMobile } = useSidebar();
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
    <NavigationSidebar variant="inset">
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
        <SidebarHeader>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only"
            onClick={(event) => {
              event.preventDefault();
              setOpenMobile(false);
              document.querySelector<HTMLElement>("#main-content")?.focus();
            }}
          >
            Skip to content
          </a>
          <div className="px-3 py-3">
            <Wordmark />
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={path.startsWith("chats/new")}>
                <a
                  href="#chats/new"
                  aria-current={path.startsWith("chats/new") ? "page" : undefined}
                  onClick={() => {
                    setOpenMobile(false);
                  }}
                >
                  New chat
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={path === "chats"}>
                <a
                  href="#chats"
                  aria-current={path === "chats" ? "page" : undefined}
                  onClick={() => {
                    setOpenMobile(false);
                  }}
                >
                  All chats
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={path.startsWith("projects")}>
                <a
                  href="#projects"
                  aria-current={path.startsWith("projects") ? "page" : undefined}
                  onClick={() => {
                    setOpenMobile(false);
                  }}
                >
                  Projects
                </a>
              </SidebarMenuButton>
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
              <SidebarGroupLabel asChild>
                <a
                  href={`#projects/${project.id}`}
                  onClick={() => {
                    setOpenMobile(false);
                  }}
                >
                  {project.name}
                </a>
              </SidebarGroupLabel>
              <SidebarMenu>
                {chats
                  ?.filter((chat) => chat.ProjectID === project.id)
                  .map((chat) => (
                    <SidebarMenuItem key={chat.ID}>
                      <SidebarMenuButton asChild isActive={path === `chats/${chat.ID}`}>
                        <a
                          href={`#chats/${chat.ID}`}
                          title={chat.Title}
                          aria-current={path === `chats/${chat.ID}` ? "page" : undefined}
                          onClick={() => {
                            setOpenMobile(false);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{chat.Title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {chat.Status === "working" ? "✿ " : ""}
                            {chat.Status.charAt(0).toUpperCase() + chat.Status.slice(1)}
                          </span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                {chats !== undefined && !chats.some((chat) => chat.ProjectID === project.id) && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <a
                        href={`#chats/new?project=${encodeURIComponent(project.id)}`}
                        onClick={() => {
                          setOpenMobile(false);
                        }}
                      >
                        Start a chat
                      </a>
                    </SidebarMenuButton>
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
