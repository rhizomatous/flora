import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { Button, Link, Text, Wordmark } from "@flora/florets";

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
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const expire = useEffectEvent(onExpired);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Route changes close the mobile navigation, including footer links.
    setOpen(false);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Navigation changes dismiss the mobile menu.
  }, [path]);
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
    <aside className="workspace-sidebar">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>("#main-content")?.focus();
        }}
        className="sr-only focus:not-sr-only"
      >
        Skip to content
      </a>
      <div className="flex items-center justify-between gap-4">
        <Wordmark />
        <Button
          type="button"
          variant="outline"
          className="sidebar-toggle"
          aria-expanded={open}
          aria-controls="workspace-navigation"
          onClick={() => {
            setOpen(!open);
          }}
        >
          Menu
        </Button>
      </div>
      <nav
        id="workspace-navigation"
        aria-label="Main"
        className={open ? "sidebar-navigation is-open" : "sidebar-navigation"}
      >
        <Link
          onClick={() => {
            setOpen(false);
          }}
          href="#chats/new"
          className="sidebar-new"
          aria-current={path.startsWith("chats/new") ? "page" : undefined}
        >
          <span aria-hidden="true">＋ </span>New chat
        </Link>
        <Link
          onClick={() => {
            setOpen(false);
          }}
          href="#chats"
          className="sidebar-link"
          aria-current={path === "chats" ? "page" : undefined}
        >
          All chats
        </Link>
        <div className="sidebar-chats">
          {error !== "" && (
            <div role="status">
              <Text size="xs">{error}</Text>
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  setRetry(retry + 1);
                }}
              >
                Retry projects
              </Button>
            </div>
          )}
          {chats === undefined && (
            <Text tone="muted" role="status">
              Loading chats…
            </Text>
          )}
          {projects.map((project) => (
            <section key={project.id} className="mt-3" aria-label={project.name}>
              <Link
                onClick={() => {
                  setOpen(false);
                }}
                href={`#projects/${project.id}`}
                className="sidebar-project"
              >
                {project.name}
              </Link>
              <ul className="mt-1">
                {chats
                  ?.filter((chat) => chat.ProjectID === project.id)
                  .map((chat) => (
                    <li key={chat.ID}>
                      <Link
                        onClick={() => {
                          setOpen(false);
                        }}
                        href={`#chats/${chat.ID}`}
                        className="sidebar-chat"
                        title={chat.Title}
                        aria-current={path === `chats/${chat.ID}` ? "page" : undefined}
                      >
                        <span className="min-w-0 flex-1 truncate">{chat.Title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {chat.Status === "working" ? "✿ " : ""}
                          {chat.Status.charAt(0).toUpperCase() + chat.Status.slice(1)}
                        </span>
                      </Link>
                    </li>
                  ))}
                {chats !== undefined && !chats.some((chat) => chat.ProjectID === project.id) && (
                  <li>
                    <Link
                      onClick={() => {
                        setOpen(false);
                      }}
                      href={`#chats/new?project=${encodeURIComponent(project.id)}`}
                      className="sidebar-link text-muted-foreground"
                    >
                      Start a chat
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
        <div className="sidebar-footer">{children}</div>
      </nav>
    </aside>
  );
}
