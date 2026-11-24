import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { z } from "zod";

import {
  Alert,
  Button,
  ButtonLink,
  Heading,
  SectionHeader,
  SettingsGroup,
  SettingsRow,
  Text,
} from "@flora/florets";

import {
  connectionSchema,
  startSchema,
  okSchema,
  repositoryPageSchema,
  type GitHubRepository,
} from "./github-schemas";
import { errorMessage, request } from "./request";
import { settingsSchema, type Settings } from "./settings-schemas";

function activeLabel(connection: z.infer<typeof connectionSchema>) {
  if (connection.active === "app") return `${connection.account} · ${connection.slug}`;
  return connection.active === "pat" ? "Personal access token" : "Disconnected";
}
function installationLabel(
  installation: z.infer<typeof connectionSchema>["installations"][number],
  connection: z.infer<typeof connectionSchema>,
) {
  if (installation.suspended_at === null) {
    if (connection.active === "app" && installation.id === connection.installationID) {
      return "Connected";
    }
    return;
  }
  return "Suspended";
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
  for (const key of ["github_callback", "code", "state", "installation_id", "setup_action"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

export function GitHubConnection({
  busy,
  run,
  onSaved,
}: {
  busy: boolean;
  run: (task: () => Promise<void>, fallback: string) => Promise<void>;
  onSaved: (settings: Settings) => void;
}) {
  const [connection, setConnection] = useState<z.infer<typeof connectionSchema>>();
  const [callback, setCallback] = useState(readCallback);
  const [repositories, setRepositories] = useState<GitHubRepository[]>();
  const [nextPage, setNextPage] = useState(0);
  const [loadError, setLoadError] = useState("");
  const initialized = useRef(false);

  async function load() {
    const view = await request(connectionSchema, "github/connection");
    setConnection(view);
    setRepositories(undefined);
    if (view.active === "app" && view.state === "connected") {
      const page = await request(repositoryPageSchema, "github/repositories");
      setRepositories(page.repositories);
      setNextPage(page.nextPage);
    }
    setLoadError("");
  }
  async function complete() {
    if (!callback) return;
    await request(okSchema, "github/complete", { method: "POST", body: callback });
    clearCallback();
    setCallback(undefined);
    onSaved(await request(settingsSchema, "settings"));
    await load();
  }
  const initialize = useEffectEvent(async () => {
    if (callback) {
      await run(async () => {
        setConnection(await request(connectionSchema, "github/connection"));
        await complete();
      }, "Could not finish GitHub setup.");
    } else {
      try {
        await load();
      } catch (error) {
        setLoadError(errorMessage(error, "Could not load GitHub connection."));
      }
    }
  });
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void initialize();
  }, []);

  function connect() {
    void run(async () => {
      const start = await request(startSchema, "github/connect", { method: "POST", body: {} });
      clearCallback();
      setCallback(undefined);
      if (start.manifest === undefined) {
        window.location.assign(start.url);
        return;
      }
      {
        const form = document.createElement("form");
        form.method = "post";
        form.action = start.url;
        const manifest = document.createElement("input");
        manifest.type = "hidden";
        manifest.name = "manifest";
        manifest.value = start.manifest;
        form.append(manifest);
        document.body.append(form);
        form.submit();
        form.remove();
      }
    }, "Could not start GitHub setup.");
  }
  function activate(id: number) {
    void run(async () => {
      await request(okSchema, "github/installation", { method: "POST", body: { id } });
      onSaved(await request(settingsSchema, "settings"));
      await load();
    }, "Could not connect GitHub installation.");
  }
  const messages: Record<string, string> = {
    disconnected: "Create your GitHub App, then install it and choose repositories on GitHub",
    created: "App created. Install it and choose repositories on GitHub",
    pending: "Organization approval requested. Refresh after an owner approves the installation",
    connected: "Connected",
    revoked: "Installation removed or access revoked. Reinstall the App to reconnect",
    suspended: "Installation suspended. Ask an organization owner to restore access on GitHub",
    unavailable: "Cannot reach the App. Check GitHub access and host networking, then refresh",
  };
  return (
    <>
      <SectionHeader inset>
        <Heading level={2}>GitHub App</Heading>
        <Text tone="muted">
          {connection ? messages[connection.state] : "Loading GitHub connection…"}
        </Text>
      </SectionHeader>
      {loadError !== "" && (
        <Alert variant="destructive" role="alert">
          {loadError}
        </Alert>
      )}
      {callback && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(complete, "Could not finish GitHub setup.");
          }}
        >
          Retry GitHub setup
        </Button>
      )}
      {!connection && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(load, "Could not refresh GitHub connection.");
          }}
        >
          Refresh GitHub connection
        </Button>
      )}
      {connection && (
        <>
          <SettingsGroup>
            <SettingsRow
              className="flex-wrap"
              label="Repository access"
              htmlFor="github-connect"
              description={activeLabel(connection)}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  aria-label={connection.slug ? "Install GitHub App" : "Connect GitHub"}
                  id="github-connect"
                  type="button"
                  disabled={busy}
                  onClick={connect}
                >
                  {connection.slug ? "Install GitHub App" : "Connect GitHub"}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void run(load, "Could not refresh GitHub connection.");
                  }}
                >
                  Refresh
                </Button>
              </div>
            </SettingsRow>
            {connection.installations.map((installation) => (
              <SettingsRow
                key={installation.id}
                htmlFor={`github-installation-${installation.id}`}
                label={installation.account.login}
                description={installationLabel(installation, connection)}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    busy ||
                    installation.suspended_at !== null ||
                    (connection.active === "app" && installation.id === connection.installationID)
                  }
                  aria-label="Use installation"
                  id={`github-installation-${installation.id}`}
                  onClick={() => {
                    activate(installation.id);
                  }}
                >
                  Use installation
                </Button>
              </SettingsRow>
            ))}
            {connection.pat && connection.active === "app" && (
              <SettingsRow label="Personal access token" htmlFor="github-use-pat">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-label="Use saved token"
                  id="github-use-pat"
                  onClick={() => {
                    void run(async () => {
                      await request(okSchema, "github/pat", { method: "POST", body: {} });
                      onSaved(await request(settingsSchema, "settings"));
                      await load();
                    }, "Could not switch to the saved token.");
                  }}
                >
                  Use saved token
                </Button>
              </SettingsRow>
            )}
          </SettingsGroup>
          {connection.slug && (
            <ButtonLink
              href={`https://github.com/apps/${encodeURIComponent(connection.slug)}/installations/new`}
            >
              Manage repository access on GitHub
            </ButtonLink>
          )}
          {repositories && (
            <SettingsGroup>
              <SettingsRow
                label="Available repositories"
                htmlFor="github-connect-project"
                description={
                  repositories.length === 0
                    ? "No repositories selected. Choose repositories on GitHub"
                    : `${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"}`
                }
              >
                <ButtonLink id="github-connect-project" href="#projects/new">
                  Connect project
                </ButtonLink>
              </SettingsRow>
              {repositories.map((repo) => (
                <Text className="px-4 py-3 break-all" key={repo.full_name}>
                  {repo.full_name}
                </Text>
              ))}
              {nextPage > 0 && (
                <SettingsRow label="More repositories" htmlFor="github-more-repositories">
                  <Button
                    type="button"
                    aria-label="Load more"
                    id="github-more-repositories"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        const page = await request(
                          repositoryPageSchema,
                          `github/repositories?page=${nextPage}`,
                        );
                        setRepositories((current) => [...(current ?? []), ...page.repositories]);
                        setNextPage(page.nextPage);
                      }, "Could not load repositories.");
                    }}
                  >
                    Load more
                  </Button>
                </SettingsRow>
              )}
            </SettingsGroup>
          )}
        </>
      )}
    </>
  );
}
