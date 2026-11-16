import { useEffect, useEffectEvent, useState, useRef } from "react";

import { Heading, Link, Text, Button, Diff } from "@flora/florets";

import { chatChangesSchema, type ChatChanges, type FileChange } from "./changes-schemas";
import { PullList } from "./pull-links";
import { isExpired, request } from "./request";

function contentNote(file: FileChange) {
  if (file.binary) return " · Binary";
  if (file.undisplayable) return " · Cannot display contents";
  return "";
}

export function Changes({
  chatID,
  onExpired,
  expanded,
  onExpand,
  onClose,
}: {
  chatID: string;
  onExpired: () => void;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
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
  const pulls = review?.pulls.items ?? [];
  return (
    <section aria-label="Chat changes" ref={container} className="chat-diffs">
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={2} ref={title} tabIndex={-1} className="mr-auto text-base">
          Chat changes
        </Heading>
        <Button variant="ghost" size="sm" className="chat-diff-expand" onClick={onExpand}>
          {expanded ? "Show chat" : "Expand"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back to chat
        </Button>
      </div>
      <Text size="xs" tone="muted" className="mt-2">
        Changes since this chat started.
      </Text>
      {review && (pulls.length > 0 || review.pulls.error !== "") && (
        <div className="mt-3">
          <PullList summary={review.pulls} />
        </div>
      )}
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
          <Text size="xs" tone="muted" role="status" className="mt-3 break-words">
            {review.stale || error !== ""
              ? "Saved review, possibly out of date"
              : "Latest saved review"}{" "}
            ·{" "}
            <time dateTime={snapshot.capturedAt}>
              {new Date(snapshot.capturedAt).toLocaleString()}
            </time>
            {snapshot.base !== "" && <> · Base {snapshot.base.slice(0, 12)}</>}
          </Text>
          {snapshot.bases !== undefined && (
            <ul aria-label="Repository bases" className="mt-2 text-xs text-muted-foreground">
              {Object.entries(snapshot.bases).map(([name, sha]) => (
                <li key={name} className="break-all">
                  {name} · Base {sha.slice(0, 12)}
                </li>
              ))}
            </ul>
          )}
          {snapshot.files.length === 0 && (
            <Text className="mt-3">No changes from the starting commit.</Text>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-xs">
              Files {snapshot.files.length}
              <select
                aria-label="Jump to file"
                className="ml-2 max-w-48 rounded border border-border bg-background p-1"
                defaultValue=""
                onChange={(event) => {
                  const file = container.current?.querySelector<HTMLDetailsElement>(
                    `[data-file-index="${event.target.value}"]`,
                  );
                  if (file) {
                    file.open = true;
                    file.scrollIntoView({ block: "start" });
                    file.querySelector("summary")?.focus();
                  }
                }}
              >
                <option value="" disabled>
                  Jump to file
                </option>
                {snapshot.files.map((file, i) => (
                  <option key={`${file.repository ?? ""}:${file.path}`} value={i}>
                    {file.repository === undefined ? "" : `${file.repository}/`}
                    {file.path}
                  </option>
                ))}
              </select>
            </label>
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
          <ul className="mt-4 space-y-3">
            {snapshot.files.map((f, i) => (
              <li key={`${f.repository ?? ""}:${f.previous ?? ""}:${f.path}`} className="min-w-0">
                <details
                  open
                  data-file-index={i}
                  className="overflow-hidden rounded-md border border-border"
                >
                  <summary className="cursor-pointer bg-muted/30 p-3 text-sm break-all">
                    <span className="mr-2 font-mono">{f.status}</span>
                    {f.repository !== undefined && (
                      <span className="mr-2 text-muted-foreground">{f.repository}</span>
                    )}
                    {f.previous !== undefined && <>{f.previous} → </>}
                    {f.path}
                    {contentNote(f)}
                    {f.additions !== undefined && f.deletions !== undefined && (
                      <span
                        className="ml-3 inline-flex gap-2 tabular-nums"
                        aria-label={`${f.additions} additions, ${f.deletions} deletions`}
                      >
                        <span className="text-emerald-700 dark:text-emerald-400">
                          +{f.additions}
                        </span>
                        <span className="text-red-700 dark:text-red-400">−{f.deletions}</span>
                      </span>
                    )}
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
