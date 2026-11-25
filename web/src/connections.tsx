import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";

import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GitHubLogoIcon,
  Heading,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
  Link,
  LoadingStatus,
  RefreshCwIcon,
  Section,
  SectionHeader,
  SectionStack,
  SettingsGroup,
  Text,
} from "@flora/florets";

import {
  connectionSchema,
  okSchema,
  repositoryPageSchema,
  startSchema,
  type GitHubRepository,
} from "./github-schemas";
import { errorMessage, isExpired, request } from "./request";
import { settingsSchema, type Settings } from "./settings-schemas";

type Connection = z.infer<typeof connectionSchema>;

function statusLabel(connection: Connection) {
  if (connection.active === "app" && connection.state === "connected") return "Connected";
  if (connection.state === "created" && connection.installations.length > 0) return "Not connected";
  const states: Record<string, string> = {
    created: "Ready to install",
    pending: "Approval pending",
    revoked: "Access revoked",
    suspended: "Suspended",
    unavailable: "Unavailable",
  };
  return states[connection.state] ?? "Not connected";
}
function ConnectionStatus({ connection }: { connection: Connection }) {
  const connected = connection.active === "app" && connection.state === "connected";
  return (
    <Badge
      variant="outline"
      className={
        connected ? "gap-1.5 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
      }
    >
      {connected && <CheckIcon aria-hidden="true" />}
      {statusLabel(connection)}
    </Badge>
  );
}
function GitHubMark({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface-panel text-foreground ${large ? "size-12" : "size-10"}`}
    >
      <GitHubLogoIcon aria-hidden="true" className={large ? "size-7" : "size-6"} />
    </span>
  );
}
function readCallback() {
  const query = new URLSearchParams(window.location.search);
  if (!query.has("github_callback")) return;
  return {
    state: query.get("state") ?? "",
    code: query.get("code") ?? "",
    installationID: Number(query.get("installation_id") ?? "0"),
    action: query.get("setup_action") ?? "",
  };
}
function clearCallback() {
  const url = new URL(window.location.href);
  for (const name of ["github_callback", "state", "code", "installation_id", "setup_action"]) {
    url.searchParams.delete(name);
  }
  window.history.replaceState(null, "", url);
}

export function ConnectionsPage({
  path,
  onSaved,
  onExpired,
}: {
  path: string;
  onSaved: (settings: Settings) => void;
  onExpired: () => void;
}) {
  const detail = path === "connections/github";
  const [connection, setConnection] = useState<Connection>();
  const [callback, setCallback] = useState(readCallback);
  const [repositories, setRepositories] = useState<GitHubRepository[]>();
  const [nextPage, setNextPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [repositoryBusy, setRepositoryBusy] = useState(false);
  const [error, setError] = useState("");
  const [repositoryError, setRepositoryError] = useState("");
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const githubRow = useRef<HTMLAnchorElement>(null);
  const previousDetail = useRef(detail);
  const connectionRead = useRef(0);
  const repositoryRead = useRef(0);
  const loadedRoute = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (previousDetail.current && !detail) githubRow.current?.focus();
    else heading.current?.focus();
    previousDetail.current = detail;
  }, [detail]);

  async function loadRepositories(page = 1) {
    const read = ++repositoryRead.current;
    setRepositoryBusy(true);
    try {
      const result = await request(repositoryPageSchema, `github/repositories?page=${page}`);
      if (read !== repositoryRead.current) return;
      setRepositories((current) =>
        page === 1 ? result.repositories : [...(current ?? []), ...result.repositories],
      );
      setNextPage(result.nextPage);
      setRepositoryError("");
    } catch (cause) {
      if (read !== repositoryRead.current) return;
      setRepositoryError(errorMessage(cause, "Could not load repositories."));
      if (isExpired(cause)) onExpired();
    } finally {
      if (read === repositoryRead.current) setRepositoryBusy(false);
    }
  }
  async function load() {
    const read = ++connectionRead.current;
    repositoryRead.current++;
    setRepositoryBusy(false);
    const view = await request(connectionSchema, "github/connection");
    if (read !== connectionRead.current) return;
    setConnection(view);
    setError("");
    if (detail && view.active === "app" && view.state === "connected") await loadRepositories();
    else {
      setRepositories(undefined);
      setRepositoryError("");
    }
  }
  async function action(task: () => Promise<void>, success?: string) {
    setBusy(true);
    try {
      await task();
      if (success !== undefined) toast.success(success, { toasterId: "chat-organization" });
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not update the GitHub connection."), {
        toasterId: "chat-organization",
      });
      if (isExpired(cause)) onExpired();
    } finally {
      setBusy(false);
    }
  }
  async function changed() {
    onSaved(await request(settingsSchema, "settings"));
    await load();
  }
  async function complete() {
    if (!callback) return;
    await request(okSchema, "github/complete", { method: "POST", body: callback });
    clearCallback();
    setCallback(undefined);
    await changed();
  }
  const initialize = useEffectEvent(async () => {
    if (callback) {
      await action(
        async () => {
          setConnection(await request(connectionSchema, "github/connection"));
          await complete();
        },
        callback.code ? "GitHub App created" : "GitHub connected",
      );
    } else {
      try {
        await load();
      } catch (cause) {
        setError(errorMessage(cause, "Could not load connections."));
        if (isExpired(cause)) onExpired();
      }
    }
  });
  useEffect(() => {
    if (loadedRoute.current === detail) return;
    loadedRoute.current = detail;
    void initialize();
  }, [detail]);

  function connect() {
    void action(async () => {
      const start = await request(startSchema, "github/connect", { method: "POST", body: {} });
      clearCallback();
      setCallback(undefined);
      if (start.manifest === undefined) {
        window.location.assign(start.url);
        return;
      }
      const form = document.createElement("form");
      form.method = "post";
      form.action = start.url;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "manifest";
      input.value = start.manifest;
      form.append(input);
      document.body.append(form);
      form.submit();
      form.remove();
    });
  }
  const connected = connection?.active === "app" && connection.state === "connected";
  const messages: Record<string, string> = {
    disconnected: "Create your GitHub App, then install it and choose repositories on GitHub",
    created: "Your App is ready. Install it on GitHub and choose repositories",
    pending: "An organization owner needs to approve the installation. Refresh after approval",
    revoked: "Repository access was revoked. Reinstall the App to reconnect",
    suspended: "An organization owner needs to restore the installation on GitHub",
    unavailable: "Could not reach the App. Check GitHub access and try refreshing",
  };
  let connectLabel = (connection?.slug ?? "") === "" ? "Connect GitHub" : "Install GitHub App";
  if ((connection?.installations.length ?? 0) > 0) connectLabel = "Install on another account";
  const visibleRepositories = repositories?.filter((repo) =>
    repo.full_name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section
      aria-labelledby="connections-heading"
      className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-10"
    >
      <div className="mb-10 px-4">
        {detail && (
          <Link
            href="#connections"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
            Connections
          </Link>
        )}
        <div className="flex items-center gap-4">
          {detail && <GitHubMark large />}
          <div className="min-w-0 flex-1">
            <Heading level={1} id="connections-heading" ref={heading} tabIndex={-1}>
              {detail ? "GitHub" : "Connections"}
            </Heading>
            <Text tone="muted" className="mt-2">
              {detail ? "Repository and pull request access" : "Connected accounts and services"}
            </Text>
          </div>
          {detail && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh GitHub connection"
              title="Refresh GitHub connection"
              disabled={busy || repositoryBusy}
              onClick={() => {
                void action(load);
              }}
            >
              <RefreshCwIcon aria-hidden="true" className={busy ? "animate-spin" : ""} />
            </Button>
          )}
        </div>
      </div>
      {error !== "" && (
        <Alert
          variant="destructive"
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void action(load);
            }}
          >
            Retry
          </Button>
        </Alert>
      )}
      {!detail && (
        <Card variant="flush">
          <Item
            size="list"
            className="rounded-xl px-4 py-5! focus-visible:ring-inset sm:px-5"
            render={<a ref={githubRow} href="#connections/github" aria-label="GitHub connection" />}
          >
            <GitHubMark />
            <ItemContent className="sm:flex-col! sm:items-start! sm:gap-1!">
              <ItemTitle className="text-foreground">GitHub</ItemTitle>
              <Text tone="muted" className="hidden sm:block">
                Repositories and pull requests
              </Text>
              <Text tone="muted" className="sm:hidden">
                Repository access
              </Text>
            </ItemContent>
            <ItemActions className="gap-3">
              {connection ? (
                <ConnectionStatus connection={connection} />
              ) : (
                <Text tone="muted">Loading…</Text>
              )}
              <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        </Card>
      )}
      {detail && (
        <SectionStack>
          {callback && (
            <Alert role="status" className="flex flex-wrap items-center justify-between gap-3">
              <span>GitHub setup is unfinished</span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void action(complete, callback.code ? "GitHub App created" : "GitHub connected");
                }}
              >
                Retry setup
              </Button>
            </Alert>
          )}
          {!connection && error === "" && <LoadingStatus>Loading GitHub connection…</LoadingStatus>}
          {connection && (
            <Section aria-labelledby="github-access-heading">
              <SectionHeader inset>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Heading level={2} id="github-access-heading">
                    Repository access
                  </Heading>
                  <ConnectionStatus connection={connection} />
                </div>
                {!connected && (
                  <Text tone="muted">
                    {connection.state === "created" && connection.installations.length > 0
                      ? "Choose an account to connect its repositories"
                      : (messages[connection.state] ?? messages.disconnected)}
                  </Text>
                )}
              </SectionHeader>
              <SettingsGroup>
                {connection.installations.map((installation) => {
                  const selected =
                    connection.active === "app" && installation.id === connection.installationID;
                  const suspended = installation.suspended_at !== null;
                  const manageURL =
                    installation.html_url ??
                    `https://github.com/apps/${encodeURIComponent(connection.slug)}/installations/new`;
                  return (
                    <div key={installation.id}>
                      <Item
                        size="list"
                        className="flex-wrap rounded-none px-4 py-4! sm:flex-nowrap"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
                          <GitHubLogoIcon className="size-5" aria-hidden="true" />
                        </span>
                        <ItemContent className="sm:flex-col! sm:items-start! sm:gap-1!">
                          <ItemTitle className="line-clamp-none break-all whitespace-normal!">
                            {installation.account.login}
                          </ItemTitle>
                          {suspended ? (
                            <Badge variant="outline">Suspended</Badge>
                          ) : (
                            <Text tone="muted">
                              {selected ? "Connected to Flora" : "Available to connect"}
                            </Text>
                          )}
                        </ItemContent>
                        <ItemActions className="ml-12 w-full flex-wrap sm:ml-0 sm:w-auto">
                          {selected ? (
                            <>
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  void action(async () => {
                                    await request(okSchema, "github/disconnect", {
                                      method: "POST",
                                      body: {},
                                    });
                                    await changed();
                                    heading.current?.focus();
                                  }, "GitHub disconnected");
                                }}
                              >
                                Unlink
                              </Button>
                              <ButtonLink
                                variant="ghost"
                                aria-label="Manage access on GitHub"
                                href={manageURL}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Manage access
                                <ExternalLinkIcon aria-hidden="true" />
                              </ButtonLink>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                disabled={busy || suspended}
                                aria-label={`Use ${installation.account.login} installation`}
                                onClick={() => {
                                  void action(async () => {
                                    await request(okSchema, "github/installation", {
                                      method: "POST",
                                      body: { id: installation.id },
                                    });
                                    await changed();
                                  }, "GitHub connected");
                                }}
                              >
                                Use installation
                              </Button>
                              <ButtonLink
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Manage ${installation.account.login} access on GitHub`}
                                title="Manage access on GitHub"
                                href={manageURL}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLinkIcon aria-hidden="true" />
                              </ButtonLink>
                            </>
                          )}
                        </ItemActions>
                      </Item>
                    </div>
                  );
                })}
                <div className="p-4">
                  <Button
                    variant={connection.installations.length > 0 ? "ghost" : "default"}
                    disabled={busy}
                    onClick={connect}
                  >
                    <GitHubLogoIcon aria-hidden="true" />
                    {connectLabel}
                    <ChevronRightIcon aria-hidden="true" />
                  </Button>
                </div>
              </SettingsGroup>
            </Section>
          )}
          {connected && (
            <Section aria-labelledby="github-repositories-heading">
              <SectionHeader inset>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Heading level={2} id="github-repositories-heading">
                    Repositories
                  </Heading>
                  <ButtonLink variant="outline" href="#projects/new">
                    Connect project
                    <ChevronRightIcon aria-hidden="true" />
                  </ButtonLink>
                </div>
              </SectionHeader>
              {repositoryError !== "" && (
                <Alert
                  variant="destructive"
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <span>{repositoryError}</span>
                  <Button
                    variant="outline"
                    disabled={repositoryBusy}
                    onClick={() => {
                      void loadRepositories();
                    }}
                  >
                    Retry repositories
                  </Button>
                </Alert>
              )}
              {repositories === undefined && repositoryBusy && (
                <LoadingStatus>Loading repositories…</LoadingStatus>
              )}
              {visibleRepositories && (
                <RepositoryList
                  repositories={visibleRepositories}
                  query={query}
                  setQuery={setQuery}
                />
              )}
              {nextPage > 0 && (
                <Button
                  variant="outline"
                  className="self-start"
                  disabled={repositoryBusy}
                  onClick={() => {
                    void loadRepositories(nextPage);
                  }}
                >
                  {repositoryBusy ? "Loading…" : "Load more repositories"}
                </Button>
              )}
            </Section>
          )}
        </SectionStack>
      )}
    </section>
  );
}

function RepositoryList({
  repositories,
  query,
  setQuery,
}: {
  repositories: GitHubRepository[];
  query: string;
  setQuery: (query: string) => void;
}) {
  return (
    <SettingsGroup>
      <div className="px-4 py-3">
        <Input
          type="search"
          aria-label="Search repositories"
          placeholder="Find a repository…"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
      </div>
      {repositories.length === 0 && (
        <Text tone="muted" className="px-4 py-6">
          {query
            ? "No matching repositories"
            : "No repositories selected. Choose repositories in Manage access"}
        </Text>
      )}
      {repositories.map((repo) => (
        <Item
          key={repo.full_name}
          size="list"
          className="rounded-none px-4 py-3!"
          render={
            <a aria-label={repo.full_name} href={repo.html_url} target="_blank" rel="noreferrer" />
          }
        >
          <ItemContent>
            <ItemTitle className="line-clamp-none break-all whitespace-normal!">
              {repo.full_name}
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <ExternalLinkIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
      ))}
    </SettingsGroup>
  );
}
