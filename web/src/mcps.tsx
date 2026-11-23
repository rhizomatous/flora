import { useEffect, useCallback, useRef, useState } from "react";
import { z } from "zod";

import {
  Alert,
  Button,
  buttonVariants,
  Heading,
  FieldLabel,
  Input,
  Text,
  SectionStack,
  Section,
  SectionHeader,
  SettingsGroup,
  SettingsRow,
  Switch,
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  ListGroup,
  LoadingStatus,
} from "@flora/florets";

import { ListPage, ListFilters, ListEmpty } from "./list-page";
import { mcpSchema, mcpDiagnosticSchema, type MCPServer, type MCPDiagnostic } from "./mcp-schemas";
import { errorMessage, isExpired, request } from "./request";

const ok = z.object({ ok: z.boolean() });
const blank = (): MCPServer => ({
  name: "",
  url: "",
  enabled: true,
  timeout: 5000,
  headerNames: [],
});
type Header = { id: string; name: string; value: string };
function readDraft(key: string, fallback: MCPServer): MCPServer {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw !== null) {
      const parsed = mcpSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* Storage may be unavailable. */
  }
  return fallback;
}

export function MCPs({ path, onExpired }: { path: string; onExpired: () => void }) {
  const [servers, setServers] = useState<MCPServer[]>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [diagnostics, setDiagnostics] = useState<Record<string, MCPDiagnostic>>({});
  const [checking, setChecking] = useState<string[]>([]);

  const selected = path.split("?")[0]?.split("/")[1];
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await request(
          mcpSchema.array(),
          "mcps",
          signal === undefined ? {} : { signal },
        );
        setServers(next);
      } catch (cause) {
        if (signal?.aborted === true) return;
        if (isExpired(cause)) onExpired();
        else setError(errorMessage(cause, "Could not load MCP servers."));
      }
    },
    [onExpired],
  );
  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- The request resolves asynchronously before updating state.
    void load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load]);
  async function check(name: string) {
    setChecking((value) => [...value, name]);
    setError("");
    try {
      const result = await request(mcpDiagnosticSchema, `mcps/${encodeURIComponent(name)}/check`, {
        method: "POST",
        body: {},
      });
      setDiagnostics((value) => ({ ...value, [name]: result }));
    } catch (cause) {
      if (isExpired(cause)) onExpired();
      else setError(errorMessage(cause, "Connection check failed."));
    } finally {
      setChecking((value) => value.filter((item) => item !== name));
    }
  }
  if (selected !== undefined && selected !== "") {
    const server = selected === "new" ? blank() : servers?.find((item) => item.name === selected);
    if (servers === undefined && selected !== "new") {
      if (error !== "") {
        return (
          <Alert variant="destructive" role="alert">
            {error}
            <Button
              onClick={() => {
                setError("");
                void load();
              }}
            >
              Retry
            </Button>
          </Alert>
        );
      }
      return <LoadingStatus>Loading MCP server…</LoadingStatus>;
    }
    if (!server) {
      return (
        <Alert role="alert">
          {error || "Server not found."} <a href="#mcps">MCP servers</a>
        </Alert>
      );
    }
    return (
      <MCPEditor
        key={selected}
        server={server}
        creating={selected === "new"}
        onExpired={onExpired}
        onSaved={() => {
          void load();
          setDiagnostics({});
          window.location.hash = "mcps";
        }}
      />
    );
  }
  const rows = (servers ?? []).filter(
    (server) =>
      (filter === "all" || server.enabled) &&
      `${server.name} ${server.url}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <ListPage
      title="MCP servers"
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search MCP servers"
      searchPlaceholder="Search by name or endpoint"
      closeSearchLabel="Close search"
      actions={
        <a href="#mcps/new" className={buttonVariants({ size: "sm" })}>
          Add server
        </a>
      }
      filters={
        <ListFilters
          label="Filter MCP servers"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All servers", count: servers?.length ?? 0 },
            {
              id: "enabled",
              label: "Enabled",
              count: servers?.filter((server) => server.enabled).length ?? 0,
            },
          ]}
        >
          <Text size="xs" tone="muted">
            All chats
          </Text>
        </ListFilters>
      }
    >
      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          {error}
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            Retry
          </Button>
        </Alert>
      )}
      {servers === undefined && error === "" && <LoadingStatus>Loading MCP servers…</LoadingStatus>}
      {servers !== undefined && rows.length === 0 && (
        <ListEmpty>{query ? "No matching servers." : "No MCP servers."}</ListEmpty>
      )}
      {servers !== undefined && rows.length > 0 && (
        <ListGroup label="Servers" listLabel="MCP servers" count={rows.length}>
          {rows.map((server) => {
            const diagnostic = diagnostics[server.name];
            const pending = checking.includes(server.name);
            return (
              <Item key={server.name} size="list" render={<li />} className="flex-wrap">
                <ItemContent className="min-w-0 basis-full flex-col! items-start! gap-1! sm:basis-0">
                  <ItemTitle>
                    <a
                      href={`#mcps/${server.name}`}
                      className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {server.name}
                    </a>
                  </ItemTitle>
                  <Text size="xs" tone="muted" className="break-all">
                    {server.url}
                  </Text>
                  <Text size="xs" tone="muted">
                    {server.enabled ? "Enabled" : "Disabled"} · {server.timeout / 1000}s timeout
                  </Text>
                  {server.headerNames.length > 0 && (
                    <Text size="xs" tone="muted" className="break-all">
                      Headers: {server.headerNames.join(", ")}
                    </Text>
                  )}
                  {diagnostic && (
                    <div role="status" className="mt-2 w-full">
                      <Text
                        className={diagnostic.status === "failed" ? "text-destructive" : undefined}
                      >
                        {diagnostic.message}
                      </Text>
                      {diagnostic.tools.length > 0 && (
                        <details className="mt-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">Discovered tools</summary>
                          <ul className="mt-2 space-y-1">
                            {diagnostic.tools.map((tool) => (
                              <li key={tool} className="font-mono break-all">
                                {tool}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!server.enabled || pending}
                    onClick={() => {
                      void check(server.name);
                    }}
                  >
                    {pending ? "Checking…" : "Check connection"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    render={<a href={`#mcps/${server.name}`} aria-label={`Edit ${server.name}`} />}
                    nativeButton={false}
                  >
                    Edit
                  </Button>
                </ItemActions>
              </Item>
            );
          })}
        </ListGroup>
      )}
    </ListPage>
  );
}

function MCPEditor({
  server,
  creating,
  onSaved,
  onExpired,
}: {
  server: MCPServer;
  creating: boolean;
  onSaved: () => void;
  onExpired: () => void;
}) {
  const draftKey = `flora-mcp-draft:${creating ? "new" : server.name}`;
  const [draft, setDraft] = useState(() => readDraft(draftKey, server));
  const [headers, setHeaders] = useState<Header[]>(() =>
    draft.headerNames.map((name) => ({ id: crypto.randomUUID(), name, value: "" })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorAlert = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (error !== "") errorAlert.current?.focus();
  }, [error]);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  function update(next: MCPServer, nextHeaders = headers) {
    setDraft(next);
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ ...next, headerNames: nextHeaders.map((header) => header.name) }),
      );
    } catch {
      /* Storage may be unavailable. */
    }
  }
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(ok, "mcps", {
        method: creating ? "POST" : "PUT",
        body: {
          ...draft,
          headerNames: headers.map((header) => header.name),
          headers: Object.fromEntries(headers.map((header) => [header.name, header.value])),
        },
      });
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Storage may be unavailable. */
      }
      if (active.current) onSaved();
    } catch (cause) {
      if (isExpired(cause)) onExpired();
      else setError(errorMessage(cause, "Could not save server."));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await request(ok, `mcps/${encodeURIComponent(server.name)}`, { method: "DELETE" });
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Storage may be unavailable. */
      }
      if (active.current) onSaved();
    } catch (cause) {
      if (isExpired(cause)) onExpired();
      else setError(errorMessage(cause, "Could not remove server."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="florets-topbar flex shrink-0 items-center gap-2 border-b px-3">
        <span className="sidebar-toggle-space" aria-hidden="true" />
        <a
          href="#mcps"
          aria-label="Back to MCP servers"
          className={buttonVariants({ size: "sm", variant: "ghost" })}
        >
          MCP servers
        </a>
        <Button className="ml-auto" type="submit" form="mcp-server-form" disabled={busy}>
          {busy ? "Saving…" : "Save server"}
        </Button>
      </header>
      <form
        id="mcp-server-form"
        onSubmit={(event) => {
          void save(event);
        }}
        className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6 sm:px-8"
      >
        <SectionStack>
          <Section>
            <Heading level={1} ref={heading} tabIndex={-1}>
              {creating ? "Add MCP server" : server.name}
            </Heading>
            <Text tone="muted">
              Streamable HTTP with optional secret headers. Local commands, legacy SSE and OAuth
              sign-in are unavailable.
            </Text>
          </Section>
          {error && (
            <Alert ref={errorAlert} tabIndex={-1} variant="destructive" role="alert">
              {error}
            </Alert>
          )}
          <fieldset disabled={busy} className="contents">
            <Section>
              <SectionHeader inset>
                <Heading level={3}>Connection</Heading>
              </SectionHeader>
              <SettingsGroup>
                <SettingsRow label="Name" htmlFor="mcp-name">
                  <Input
                    id="mcp-name"
                    value={draft.name}
                    disabled={!creating}
                    required
                    maxLength={48}
                    pattern="[a-z][a-z0-9-]*"
                    onChange={(event) => {
                      update({ ...draft, name: event.target.value });
                    }}
                  />
                </SettingsRow>
                <div className="space-y-2 px-4 py-3">
                  <FieldLabel htmlFor="mcp-url" className="text-sm font-medium">
                    Endpoint URL
                  </FieldLabel>
                  <Input
                    id="mcp-url"
                    type="url"
                    value={draft.url}
                    required
                    maxLength={2048}
                    placeholder="https://example.com/mcp"
                    onChange={(event) => {
                      update({ ...draft, url: event.target.value });
                    }}
                  />
                </div>
                <SettingsRow label="Timeout (milliseconds)" htmlFor="mcp-timeout">
                  <Input
                    className="w-28"
                    id="mcp-timeout"
                    type="number"
                    min={1000}
                    max={30_000}
                    required
                    value={draft.timeout}
                    onChange={(event) => {
                      update({ ...draft, timeout: Number(event.target.value) });
                    }}
                  />
                </SettingsRow>
                <SettingsRow label="Enabled" htmlFor="mcp-enabled">
                  <Switch
                    id="mcp-enabled"
                    checked={draft.enabled}
                    onCheckedChange={(enabled) => {
                      update({ ...draft, enabled });
                    }}
                  />
                </SettingsRow>
              </SettingsGroup>
            </Section>
            <Section>
              <SectionHeader inset>
                <Heading level={3}>Secret headers</Heading>
              </SectionHeader>
              <SettingsGroup>
                <div className="space-y-3 p-4">
                  {headers.length === 0 && (
                    <Text size="sm" tone="muted">
                      No headers
                    </Text>
                  )}
                  {headers.map((header, index) => (
                    <div key={header.id} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1 basis-40 space-y-2">
                        <FieldLabel className="text-sm" htmlFor={`header-name-${index}`}>
                          Header name
                        </FieldLabel>
                        <Input
                          id={`header-name-${index}`}
                          value={header.name}
                          required
                          maxLength={64}
                          placeholder="Authorization"
                          onChange={(event) => {
                            const next = headers.map((item, i) =>
                              i === index ? { ...item, name: event.target.value } : item,
                            );
                            setHeaders(next);
                            update(draft, next);
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1 basis-40 space-y-2">
                        <FieldLabel className="text-sm" htmlFor={`header-value-${index}`}>
                          Secret value
                        </FieldLabel>
                        <Input
                          id={`header-value-${index}`}
                          type="password"
                          autoComplete="new-password"
                          value={header.value}
                          required={!server.headerNames.includes(header.name)}
                          maxLength={4096}
                          placeholder={
                            server.headerNames.includes(header.name) ? "Unchanged" : "Bearer …"
                          }
                          onChange={(event) => {
                            setHeaders(
                              headers.map((item, i) =>
                                i === index ? { ...item, value: event.target.value } : item,
                              ),
                            );
                          }}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        type="button"
                        aria-label={`Remove header ${index + 1}`}
                        onClick={() => {
                          const next = headers.filter((_, i) => i !== index);
                          setHeaders(next);
                          update(draft, next);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={headers.length >= 16}
                    onClick={() => {
                      setHeaders([...headers, { id: crypto.randomUUID(), name: "", value: "" }]);
                    }}
                  >
                    Add header
                  </Button>
                </div>
              </SettingsGroup>
            </Section>
            <div className="flex flex-wrap gap-2">
              <a href="#mcps" className={buttonVariants({ variant: "ghost" })}>
                Cancel
              </a>
              {!creating && (
                <Button
                  type="button"
                  variant="ghost"
                  className="sm:ml-auto"
                  onClick={() => {
                    setDeleting(true);
                  }}
                >
                  Remove server
                </Button>
              )}
            </div>
            {deleting && (
              <Alert role="alert">
                <Text>Remove {server.name}?</Text>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      void remove();
                    }}
                  >
                    Remove server
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDeleting(false);
                    }}
                  >
                    Keep server
                  </Button>
                </div>
              </Alert>
            )}
          </fieldset>
        </SectionStack>
      </form>
    </div>
  );
}
