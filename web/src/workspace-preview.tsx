import { useEffect, useRef, useState } from "react";

import {
  Button,
  CodeBlock,
  CodeBlockContent,
  CodeBlockLine,
  CodeBlockCopyButton,
  FileTypeIcon,
  FilesIcon,
  ChevronRightIcon,
  ArrowDownIcon,
  RefreshCwIcon,
} from "@flora/florets";
import { useHighlightedCode } from "@flora/florets/hooks/use-highlighted-code";

import { useChatPanelState } from "./chat-panel-state";
import { errorMessage, RequestError } from "./request";
import { previewSchema, useWorkspaceResource, workspaceURL } from "./workspace-data";

function SourceCode({ text, path }: { text: string; path: string }) {
  const name = path.split("/").at(-1) ?? path;
  const language = name.includes(".") ? (name.split(".").at(-1) ?? "text") : name.toLowerCase();
  const lines = useHighlightedCode(text, language);
  return (
    <CodeBlock className="workspace-code min-h-0 flex-1 rounded-none border-0 bg-surface-panel text-[13px]">
      <CodeBlockContent lineNumbers aria-label="File contents" className="flex-1 py-2 leading-6">
        {lines.map((line, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- File lines keep their source positions, including empty and repeated lines.
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function FileContents({ kind, text, path }: { kind: string; text: string; path: string }) {
  if (kind === "binary") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <FileTypeIcon path={path} />
        <p>Preview unavailable for binary or non-UTF-8 files.</p>
      </div>
    );
  }
  if (text === "") return <p className="p-6 text-sm text-muted-foreground">Empty file</p>;
  return <SourceCode text={text} path={path} />;
}

export function WorkspacePreview({
  chatID,
  file,
  active,
  onExpired,
}: {
  chatID: string;
  file: { repository: string; path: string };
  active: boolean;
  onExpired: () => void;
}) {
  const [, update] = useChatPanelState(chatID);
  const [revision, setRevision] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const toolbar = useRef<HTMLButtonElement>(null);
  const location = workspaceURL(chatID, file, { revision });
  const { data: preview, error } = useWorkspaceResource(
    previewSchema,
    `${location}&action=preview`,
    { active, onExpired },
  );
  useEffect(() => {
    if (active) toolbar.current?.focus({ preventScroll: true });
  }, [active]);
  async function download() {
    if (!preview || downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(
        `/api/${location}&action=download&version=${encodeURIComponent(preview.version)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        if (response.status === 401) onExpired();
        const body: unknown = await response.json();
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Download failed. Refresh and try again.";
        throw new RequestError(message, response.status);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.path.split("/").at(-1) ?? "download";
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
  return (
    <section
      aria-label={`${file.repository}/${file.path} preview`}
      className="flex h-full min-h-0 min-w-0 flex-col bg-surface-panel"
    >
      <div className="workspace-file-toolbar flex min-h-11 shrink-0 items-center gap-2 border-b bg-surface-canvas px-3">
        <Button
          ref={toolbar}
          variant="ghost"
          size="icon-sm"
          aria-label="Show files"
          title="Show files"
          onClick={() => {
            update({ filesOpen: true, mainView: "files" });
          }}
        >
          <FilesIcon />
        </Button>
        <div
          className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground"
          title={`${file.repository}/${file.path}`}
        >
          <span className="max-w-[40%] shrink-0 truncate sm:max-w-none">{file.repository}</span>
          <ChevronRightIcon className="size-3 shrink-0" />
          <span className="truncate">{file.path}</span>
        </div>
        <CodeBlockCopyButton
          value={preview?.text ?? ""}
          disabled={preview?.kind !== "text"}
          size="icon-sm"
          aria-label="Copy file preview"
          title="Copy file preview"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh file"
          title="Refresh file"
          onClick={() => {
            setRevision((v) => v + 1);
            setDownloadError("");
          }}
        >
          <RefreshCwIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={downloading ? "Downloading…" : "Download"}
          title="Download"
          disabled={preview?.downloadable !== true || downloading}
          onClick={() => {
            void download();
          }}
        >
          <ArrowDownIcon />
        </Button>
      </div>
      {downloadError && (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {downloadError}
        </p>
      )}
      {error && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {!preview && !error && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading preview…
        </p>
      )}
      {preview && (
        <>
          {!preview.downloadable && (
            <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">
              This file exceeds the 64 MiB download limit.
            </p>
          )}
          {preview.truncated && preview.kind === "text" && (
            <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">
              Showing the first 256 KiB.{preview.downloadable ? " Download for the full file." : ""}
            </p>
          )}
          <FileContents kind={preview.kind} text={preview.text} path={file.path} />
        </>
      )}
    </section>
  );
}
