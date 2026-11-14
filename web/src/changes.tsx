import { useEffect, useEffectEvent, useState } from "react";

import { Heading, Link, Text } from "@flora/florets";

import { chatChangesSchema, type ChatChanges, type FileChange } from "./changes-schemas";
import { PullList } from "./pull-links";
import { isExpired, request } from "./request";

function contentNote(file: FileChange) {
  if (file.binary) return " · Binary";
  if (file.undisplayable) return " · Cannot display contents";
  return "";
}

export function Changes({ chatID, onExpired }: { chatID: string; onExpired: () => void }) {
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
    <section
      aria-label="Changes"
      className="mt-8 min-w-0 rounded-md border border-foreground/20 p-4"
    >
      <Heading level={2}>Changes</Heading>
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
          <ul className="mt-4 space-y-3">
            {snapshot.files.map((f, i) => (
              <li key={`${f.repository ?? ""}:${f.previous ?? ""}:${f.path}`} className="min-w-0">
                <details className="rounded-md border border-foreground/20 p-3">
                  <summary className="cursor-pointer text-sm break-all">
                    <span className="mr-2 font-mono">{f.status}</span>
                    {f.repository !== undefined && (
                      <span className="mr-2 text-muted-foreground">{f.repository}</span>
                    )}
                    {f.previous !== undefined && <>{f.previous} → </>}
                    {f.path}
                    {contentNote(f)}
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
                  {f.diff !== "" && (
                    <pre
                      tabIndex={0}
                      aria-label={`Diff for ${f.path}`}
                      className="mt-3 max-h-[32rem] overflow-auto font-mono text-xs leading-5 whitespace-pre"
                    >
                      {f.diff}
                    </pre>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
