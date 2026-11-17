import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";

import { Button, ExternalLinkIcon, Link, Text } from "@flora/florets";

import { ChangeReview } from "./changes";
import { snapshotSchema } from "./changes-schemas";
import { isExpired, request } from "./request";

const revisionSchema = z.object({ repository: z.string(), ref: z.string(), sha: z.string() });
const schema = z.object({
  snapshot: snapshotSchema
    .extend({
      url: z.string(),
      title: z.string(),
      baseRevision: revisionSchema,
      headRevision: revisionSchema,
    })
    .nullable(),
  error: z.string(),
  stale: z.boolean(),
});

export function PullComparison({
  chatID,
  url,
  onExpired,
}: {
  chatID: string;
  url: string;
  onExpired: () => void;
}) {
  const [review, setReview] = useState<z.infer<typeof schema>>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const expired = useEffectEvent(onExpired);
  const match = /^https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/i.exec(
    url,
  );
  const repository = match?.[1] ?? "";
  const number = match?.[2] ?? "";
  const query = new URLSearchParams({ repository, number }).toString();
  const path = `chats/${encodeURIComponent(chatID)}/pull-comparison`;
  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    void (async () => {
      try {
        const saved = await request(schema, `${path}?${query}`);
        if (!active()) return;
        setReview(saved);
        const latest = await request(schema, `${path}?${query}`, { method: "POST" });
        if (active()) {
          setReview(latest);
          setError("");
        }
      } catch (e) {
        if (active()) {
          setError(
            "Comparison unavailable. Any saved comparison below may be out of date. Retry or open the pull request on GitHub.",
          );
          if (isExpired(e)) expired();
        }
      } finally {
        if (active()) setBusy(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [path, query]);
  const snapshot = review?.snapshot;
  return (
    <section aria-label="Pull request comparison" className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open pull request on GitHub"
            className="min-w-0 flex-1 text-sm break-all"
          >
            {repository} #{number}{" "}
            <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-3" />
          </Link>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  setReview(await request(schema, `${path}?${query}`, { method: "POST" }));
                  setError("");
                } catch (e) {
                  setError("Refresh failed. Saved comparison retained. Retry or open GitHub.");
                  if (isExpired(e)) onExpired();
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {snapshot && (
          <>
            <p className="text-sm font-medium break-words">{snapshot.title}</p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {(
                [
                  ["Base", snapshot.baseRevision],
                  ["Head", snapshot.headRevision],
                ] as const
              ).map(([label, revision]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all">
                    {revision.repository}:{revision.ref}{" "}
                    <span className="font-mono text-muted-foreground" title={revision.sha}>
                      {revision.sha.slice(0, 12)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <Text size="xs" tone="muted">
              Fetched{" "}
              <time dateTime={snapshot.capturedAt}>
                {new Date(snapshot.capturedAt).toLocaleString()}
              </time>
            </Text>
          </>
        )}
        {busy && (
          <span role="status" className="sr-only">
            Fetching GitHub comparison
          </span>
        )}
      </div>
      <ChangeReview
        label="Pull request changes"
        review={review}
        error={error}
        download={(index, id) =>
          `/api/${path}/${index}/diff?${query}&snapshot=${encodeURIComponent(id)}`
        }
      />
    </section>
  );
}
