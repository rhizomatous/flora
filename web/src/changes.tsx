import { useEffect, useEffectEvent, useState, useRef } from "react";

import {
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Heading,
  Link,
  Text,
  Button,
  Diff,
  FileTypeIcon,
} from "@flora/florets";

import {
  chatChangesSchema,
  changeStatus,
  type ChatChanges,
  type FileChange,
} from "./changes-schemas";
import { ChangeCounts, DiffFiles } from "./diff-files";
import { isExpired, request } from "./request";

function contentNote(file: FileChange) {
  if (file.binary) return " · Binary";
  if (file.undisplayable) return " · Cannot display contents";
  return "";
}

export function Changes({ chatID, onExpired }: { chatID: string; onExpired: () => void }) {
  const container = useRef<HTMLElement>(null);
  const [anyExpanded, setAnyExpanded] = useState(true);
  const [review, setReview] = useState<ChatChanges>();
  const [error, setError] = useState("");
  const expire = useEffectEvent(onExpired);
  // The parent keys this component by chat, so state starts empty for each chat.
  useEffect(() => {
    let active = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await request(
          chatChangesSchema,
          `chats/${encodeURIComponent(chatID)}/changes`,
        );
        if (active) {
          setReview(data);
          setError("");
        }
      } catch (e) {
        if (active) {
          setError("Changes unavailable. Any review shown below is saved and may be out of date.");
          if (isExpired(e)) expire();
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [chatID]);
  const snapshot = review?.snapshot;
  const multipleRepositories = new Set(snapshot?.files.map((file) => file.repository)).size > 1;
  const countsKnown =
    snapshot?.files.every((file) => file.additions !== undefined && file.deletions !== undefined) ??
    false;
  const totals = { additions: 0, deletions: 0 };
  for (const file of snapshot?.files ?? []) {
    totals.additions += file.additions ?? 0;
    totals.deletions += file.deletions ?? 0;
  }
  return (
    <section aria-label="Chat changes" ref={container} className="chat-diffs">
      <Heading level={2} className="sr-only">
        Chat changes
      </Heading>
      {error !== "" && (
        <Text role="alert" className="mt-3">
          {error}
        </Text>
      )}
      {review !== undefined && review.error !== "" && (
        <Text role="alert" className="mt-3">
          {review.error}
        </Text>
      )}
      {review === undefined && error === "" && (
        <Text role="status" className="mt-3">
          Loading changes…
        </Text>
      )}
      {snapshot === null && <Text className="mt-3">No successful review saved yet.</Text>}
      {snapshot && (
        <>
          <div className="diff-toolbar flex min-h-9 shrink-0 items-center gap-1 border-b border-border px-3 py-1">
            <span className="flex-1" />
            <DiffFiles
              files={snapshot.files}
              onSelect={(index) => {
                const file = container.current?.querySelector<HTMLDetailsElement>(
                  `[data-file-index="${index}"]`,
                );
                if (file) {
                  file.open = true;
                  file.scrollIntoView({ block: "start" });
                }
                return file?.querySelector("summary") ?? undefined;
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={anyExpanded ? "Collapse all" : "Expand all"}
              title={anyExpanded ? "Collapse all" : "Expand all"}
              disabled={snapshot.files.length === 0}
              onClick={() => {
                const files =
                  container.current?.querySelectorAll<HTMLDetailsElement>("details") ?? [];
                const expand = ![...files].some((file) => file.open);
                for (const file of files) file.open = expand;
                setAnyExpanded(expand);
              }}
            >
              {anyExpanded ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
            </Button>
          </div>
          <div className="diff-scroll min-h-0 flex-1 overflow-auto px-3 pb-4">
            <div
              className="flex w-fit items-center gap-3 py-3 text-xs text-muted-foreground"
              aria-label="Change summary"
            >
              <span>
                {snapshot.files.length} {snapshot.files.length === 1 ? "file" : "files"}
              </span>
              {countsKnown && (
                <ChangeCounts additions={totals.additions} deletions={totals.deletions} />
              )}
            </div>
            {(review.stale || error !== "") && (
              <Text role="status" size="xs" tone="muted" className="my-2">
                Saved changes may be out of date.
              </Text>
            )}
            {snapshot.files.length === 0 && (
              <Text className="mt-3">No changes from the starting commit.</Text>
            )}
            <ul className="space-y-2">
              {snapshot.files.map((f, i) => (
                <li key={`${f.repository ?? ""}:${f.previous ?? ""}:${f.path}`} className="min-w-0">
                  {multipleRepositories &&
                    (i === 0 || snapshot.files[i - 1]?.repository !== f.repository) && (
                      <Heading level={3} className="py-2 text-sm">
                        {f.repository ?? "Repository"}
                      </Heading>
                    )}
                  <details
                    open
                    data-file-index={i}
                    onToggle={() => {
                      setAnyExpanded(
                        [
                          ...(container.current?.querySelectorAll<HTMLDetailsElement>("details") ??
                            []),
                        ].some((file) => file.open),
                      );
                    }}
                    className="overflow-hidden rounded-md border border-border"
                  >
                    <summary className="diff-file-heading flex cursor-pointer items-center gap-2 bg-muted/30 px-2.5 py-1.5 text-sm break-all">
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="diff-file-caret size-3 shrink-0 text-muted-foreground"
                      />
                      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-2 align-middle">
                        <FileTypeIcon path={f.path} />
                        <span className="font-medium">{f.path.split("/").at(-1)}</span>
                        <span className="min-w-0 text-xs text-muted-foreground">
                          {f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : ""}
                        </span>
                        {f.status !== "M" && (
                          <span className="text-xs text-muted-foreground">
                            {changeStatus(f.status)}
                          </span>
                        )}
                        {f.previous !== undefined && <>{f.previous} → </>}
                        {contentNote(f)}
                        <ChangeCounts additions={f.additions} deletions={f.deletions} />
                      </span>
                    </summary>
                    {f.truncated && (
                      <Text className="mt-3">
                        Diff exceeds the configured inline limit ({f.bytes.toLocaleString()} bytes).{" "}
                        <Link
                          href={`/api/chats/${encodeURIComponent(chatID)}/changes/${i}/diff?snapshot=${encodeURIComponent(snapshot.id)}`}
                        >
                          Download full diff
                        </Link>
                      </Text>
                    )}
                    {f.diff !== "" && <Diff patch={f.diff} path={f.path} />}
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
