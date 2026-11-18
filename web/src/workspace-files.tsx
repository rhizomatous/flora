import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  Button,
  NativeSelect,
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  ListGroup,
  FolderIcon,
  FilesIcon,
  ChevronLeftIcon,
  RefreshCwIcon,
  ArrowDownIcon,
} from "@flora/florets";

import { useChatPanelState } from "./chat-panel-state";
import { chatSchema } from "./chat-schemas";
import { ListPage, ListFilters } from "./list-page";
import { request, errorMessage, isExpired, RequestError } from "./request";
import { RuntimeMenu } from "./runtime-controls";
import { useRuntime } from "./runtime-state";

const repositorySchema = z.object({ name: z.string(), role: z.string() });
const repositoriesSchema = z.object({ repositories: z.array(repositorySchema) });
const entrySchema = z.object({ name: z.string(), kind: z.string() });
const listingSchema = z.object({
  entries: z.array(entrySchema),
  truncated: z.boolean(),
  nextOffset: z.number(),
});
const previewSchema = z.object({
  size: z.number(),
  version: z.string(),
  kind: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  downloadable: z.boolean(),
});
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;

/** Browses persisted workspace files. Only navigation is saved in panel state. */
export function WorkspaceFiles({
  chatID,
  active,
  onExpired,
}: {
  chatID: string;
  active: boolean;
  onExpired: () => void;
}) {
  const [state, update] = useChatPanelState(chatID);
  const {
    fileRepository: repository,
    fileDirectory: directory,
    filePath: file,
    fileOffset: offset,
  } = state;
  const [repositories, setRepositories] = useState<
    z.infer<typeof repositoriesSchema>["repositories"]
  >([]);
  const [listingData, setListingData] = useState<{
    location: string;
    value: z.infer<typeof listingSchema>;
  }>();
  const [previewData, setPreviewData] = useState<{
    location: string;
    value: z.infer<typeof previewSchema>;
  }>();
  const [error, setError] = useState("");
  const [repositoriesLoading, setRepositoriesLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [revision, setRevision] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const { runtime } = useRuntime(chatID, active);
  const base = `chats/${encodeURIComponent(chatID)}/workspace`;
  const repositoryURL = `${base}?refresh=${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const value = await request(repositoriesSchema, repositoryURL, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setRepositories(value.repositories);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(errorMessage(e, "Could not load repositories."));
          if (isExpired(e)) onExpired();
        }
      } finally {
        if (!controller.signal.aborted) setRepositoriesLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, [repositoryURL, onExpired]);
  const selectedRepository = repository === "" ? (repositories[0]?.name ?? "") : repository;
  const requestLocation = `${base}?${new URLSearchParams({ repository: selectedRepository, path: file || directory, revision: String(revision), offset: String(offset) })}`;
  const listing = listingData?.location === requestLocation ? listingData.value : undefined;
  const preview = previewData?.location === requestLocation ? previewData.value : undefined;
  useEffect(() => {
    if (!selectedRepository || !active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void load();
    }, 0);
    async function load() {
      setError("");
      setListingData(undefined);
      setPreviewData(undefined);
      setDownloadError("");
      try {
        if (file) {
          const value = await request(previewSchema, `${requestLocation}&action=preview`, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setPreviewData({ location: requestLocation, value });
        } else {
          const value = await request(listingSchema, requestLocation, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) setListingData({ location: requestLocation, value });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(errorMessage(e, "Could not read workspace files."));
          if (isExpired(e)) onExpired();
        }
      }
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedRepository, file, requestLocation, active, onExpired]);
  useEffect(() => {
    if (file && active) heading.current?.focus();
  }, [file, active]);
  const refresh = () => {
    setRevision((value) => value + 1);
  };
  function back() {
    update(
      file
        ? { filePath: "" }
        : { fileDirectory: directory.split("/").slice(0, -1).join("/") || ".", fileOffset: 0 },
    );
    setQuery("");
  }
  async function download() {
    if (!preview || downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(
        `/api/${requestLocation}&action=download&version=${encodeURIComponent(preview.version)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        if (response.status === 401) onExpired();
        const diagnostic = z.object({ error: z.string() }).safeParse(await response.json());
        throw new RequestError(
          diagnostic.success ? diagnostic.data.error : "Download failed. Refresh and try again.",
          response.status,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.split("/").at(-1) ?? "download";
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e) {
      setDownloadError(errorMessage(e, "Download failed. Refresh and try again."));
    } finally {
      setDownloading(false);
    }
  }
  async function stop() {
    try {
      await request(chatSchema, `chats/${encodeURIComponent(chatID)}/stop`, {
        method: "POST",
        body: {},
      });
      refresh();
    } catch (e) {
      setError(errorMessage(e, "Could not stop machine."));
      if (isExpired(e)) onExpired();
    }
  }
  const unavailable =
    runtime?.state === "stopped" || runtime?.state === "missing" || runtime?.state === "failed";
  const status = (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
      <span>
        {unavailable
          ? `Machine ${runtime.state === "stopped" ? "asleep" : runtime.state}. Reading saved workspace.`
          : "Saved workspace"}
      </span>
      <RuntimeMenu
        id={chatID}
        disabled={false}
        onStop={() => {
          void stop();
        }}
      />
    </div>
  );
  const repositoryControl = (
    <NativeSelect
      aria-label="Workspace repository"
      value={selectedRepository}
      onChange={(event) => {
        update({
          fileRepository: event.target.value,
          fileDirectory: ".",
          filePath: "",
          fileOffset: 0,
        });
        setQuery("");
      }}
      className="w-full min-w-0"
    >
      {repositories.length === 0 && (
        <option value="">
          {repositoriesLoading ? "Loading repositories…" : "No repositories"}
        </option>
      )}
      {repositories.map((r) => (
        <option key={r.name} value={r.name}>
          {r.name}
          {r.role === "extra" ? " (extra)" : ""}
        </option>
      ))}
    </NativeSelect>
  );
  const tools = (
    <div className="flex shrink-0 items-center gap-1">
      {(file || directory !== ".") && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={file ? "Back to folder" : "Parent folder"}
          onClick={back}
        >
          <ChevronLeftIcon />
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Refresh files" onClick={refresh}>
        <RefreshCwIcon />
      </Button>
    </div>
  );
  const loadingLabel = file ? "preview" : "files";
  let message = null;
  if (error) {
    message = (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error}
      </p>
    );
  } else if (repositoriesLoading || (selectedRepository && !(file ? preview : listing))) {
    message = (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading {repositoriesLoading ? "repositories" : loadingLabel}…
      </p>
    );
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {status}
      {file ? (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            {tools}
            <h2 ref={heading} tabIndex={-1} className="min-w-0 flex-1 text-sm wrap-anywhere">
              {file.split("/").at(-1)}
            </h2>
            <Button
              variant="secondary"
              size="compact"
              disabled={preview?.downloadable !== true || downloading}
              onClick={() => {
                void download();
              }}
            >
              <ArrowDownIcon />
              {downloading ? "Downloading…" : "Download"}
            </Button>
          </div>
          <div className="border-b px-4 py-2 text-xs wrap-anywhere text-muted-foreground">
            {selectedRepository} / {file}
            {preview && ` · ${size(preview.size)}`}
          </div>
          {downloadError && (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">
              {downloadError}
            </p>
          )}
          {message}
          {preview && (
            <>
              {!preview.downloadable && (
                <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">
                  This file exceeds the 64 MiB download limit.
                </p>
              )}
              {preview.truncated && preview.kind === "text" && (
                <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">
                  {preview.downloadable
                    ? "Showing the first 256 KiB. Download for the full file."
                    : "Showing the first 256 KiB."}
                </p>
              )}
              {preview.kind === "binary" ? (
                <p className="p-6 text-sm text-muted-foreground">
                  Preview unavailable for binary or non-UTF-8 files.
                </p>
              ) : (
                <pre
                  tabIndex={0}
                  aria-label="File contents"
                  className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-6 select-text"
                >
                  {preview.text || "Empty file"}
                </pre>
              )}
            </>
          )}
        </>
      ) : (
        <ListPage
          title="Machine files"
          query={query}
          onQueryChange={setQuery}
          searchLabel="Find in folder"
          searchPlaceholder="Find in this page…"
          closeSearchLabel="Close file search"
          actions={tools}
          filters={
            <ListFilters
              label="File filters"
              options={[
                { id: "all", label: "All files", count: listing?.entries.length ?? 0 },
                {
                  id: "folders",
                  label: "Folders",
                  count: listing?.entries.filter((e) => e.kind === "directory").length ?? 0,
                },
              ]}
              value={filter}
              onChange={setFilter}
            >
              {repositoryControl}
              <p className="mt-2 text-xs wrap-anywhere text-muted-foreground">
                /{directory === "." ? "" : directory}
              </p>
            </ListFilters>
          }
        >
          {message}
          {!error && !repositoriesLoading && repositories.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No repositories in this workspace.</p>
          )}
          {listing && (
            <ListGroup label="Files" listLabel="Workspace files" count={listing.entries.length}>
              {listing.entries
                .filter(
                  (entry) =>
                    (filter === "all" || entry.kind === "directory") &&
                    entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                )
                .map((entry) => (
                  <Item key={entry.name} size="list">
                    <ItemContent>
                      <ItemTitle>
                        <button
                          type="button"
                          className="flex w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:text-muted-foreground"
                          disabled={entry.kind === "unsupported" || entry.kind === "symlink"}
                          onClick={() => {
                            const next =
                              directory === "." ? entry.name : `${directory}/${entry.name}`;
                            update(
                              entry.kind === "directory"
                                ? {
                                    fileRepository: selectedRepository,
                                    fileDirectory: next,
                                    fileOffset: 0,
                                  }
                                : { fileRepository: selectedRepository, filePath: next },
                            );
                            setQuery("");
                          }}
                        >
                          {entry.kind === "directory" ? (
                            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <FilesIcon className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate" title={entry.name}>
                            {entry.name}
                          </span>
                        </button>
                      </ItemTitle>
                    </ItemContent>
                    {entry.kind !== "file" && entry.kind !== "directory" && (
                      <ItemActions>
                        <span className="text-xs text-muted-foreground">
                          {entry.kind === "symlink" ? "Symlink" : "Unsupported"}
                        </span>
                      </ItemActions>
                    )}
                  </Item>
                ))}
              {listing.entries.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">This folder is empty.</p>
              )}
              {listing.entries.length > 0 &&
                !listing.entries.some(
                  (entry) =>
                    (filter === "all" || entry.kind === "directory") &&
                    entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                ) && (
                  <p className="p-3 text-sm text-muted-foreground">
                    No matching files in this folder.
                  </p>
                )}
            </ListGroup>
          )}
          {listing?.truncated === true && (
            <p role="status" className="p-3 text-xs text-muted-foreground">
              Showing entries {offset + 1} to {offset + 500}. Search covers this page.
            </p>
          )}
          {(offset > 0 || listing?.truncated === true) && (
            <div className="flex items-center justify-between gap-2 pt-3">
              <Button
                variant="secondary"
                size="compact"
                disabled={offset === 0 || !listing}
                onClick={() => {
                  update({ fileOffset: Math.max(0, offset - 500) });
                  setQuery("");
                }}
              >
                Previous page
              </Button>
              <Button
                variant="secondary"
                size="compact"
                disabled={listing?.truncated !== true}
                onClick={() => {
                  if (listing) update({ fileOffset: listing.nextOffset });
                  setQuery("");
                }}
              >
                Next page
              </Button>
            </div>
          )}
        </ListPage>
      )}
    </div>
  );
}
