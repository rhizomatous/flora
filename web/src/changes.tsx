import { useEffect, useEffectEvent, useState, useRef } from "react";

import {
  ChevronDownIcon,
  Heading,
  Link,
  Text,
  Button,
  Diff,
  FileTypeIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverTitle,
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
          <div className="diff-toolbar flex flex-wrap items-center gap-1 border-b border-border pb-2">
            <Popover>
              <PopoverTrigger
                render={
                  <Button variant="ghost" size="sm" aria-label="Diff details">
                    Chat changes{review.stale || error !== "" ? " · Out of date" : ""}
                    <ChevronDownIcon />
                  </Button>
                }
              />
              <PopoverContent
                align="start"
                className="max-w-[calc(100vw-24px)]"
                aria-label="Diff details"
              >
                <PopoverTitle>Changes since this chat started</PopoverTitle>
                <Text size="xs" tone="muted" role="status" className="mt-2 break-words">
                  {review.stale || error !== ""
                    ? "Saved review, possibly out of date"
                    : "Latest saved review"}{" "}
                  ·{" "}
                  <time dateTime={snapshot.capturedAt}>
                    {new Date(snapshot.capturedAt).toLocaleString()}
                  </time>
                </Text>
                {snapshot.base !== "" && (
                  <Text size="xs" tone="muted" className="mt-2 break-all">
                    Base {snapshot.base}
                  </Text>
                )}
                {snapshot.bases !== undefined && (
                  <ul aria-label="Repository bases" className="mt-2 text-xs text-muted-foreground">
                    {Object.entries(snapshot.bases).map(([name, sha]) => (
                      <li key={name} className="break-all">
                        {name} · {sha}
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
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
              size="sm"
              onClick={() => {
                for (const file of container.current?.querySelectorAll("details") ?? []) {
                  file.open = false;
                }
              }}
            >
              Collapse all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                for (const file of container.current?.querySelectorAll("details") ?? []) {
                  file.open = true;
                }
              }}
            >
              Expand all
            </Button>
          </div>
          <div
            className="my-3 flex w-fit items-center gap-3 text-xs text-muted-foreground"
            aria-label="Change summary"
          >
            <span>
              {snapshot.files.length} {snapshot.files.length === 1 ? "file" : "files"}
            </span>
            {countsKnown && (
              <ChangeCounts additions={totals.additions} deletions={totals.deletions} />
            )}
          </div>
          {snapshot.files.length === 0 && (
            <Text className="mt-3">No changes from the starting commit.</Text>
          )}
          <ul className="space-y-3">
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
                  className="overflow-hidden rounded-md border border-border"
                >
                  <summary className="cursor-pointer bg-muted/30 p-3 text-sm break-all">
                    <span className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 align-middle">
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
        </>
      )}
    </section>
  );
}
