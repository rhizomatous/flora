import { useEffect, useState } from "react";
import { request, RequestError } from "./request";

type FileChange = { path: string; previous?: string; status: string; binary: boolean; undisplayable: boolean; diff: string; bytes: number; truncated: boolean };
type Review = { snapshot: { id: string; capturedAt: string; base: string; files: FileChange[] } | null; stale: boolean; error: string; pulls: { items: { url: string; number: number; state: string; draft: boolean }[] | null; error: string; checkedAt: string } };

export function Changes({ chatID, onExpired }: { chatID: string; onExpired: () => void }) {
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let loading = false;
    setReview(undefined); setError("");
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await request<Review>(`chats/${encodeURIComponent(chatID)}/changes`);
        if (active) { setReview(data); setError(""); }
      } catch (e) {
        if (active) {
          setError("Changes unavailable. Any review shown below is saved and may be out of date.");
          if (e instanceof RequestError && e.status === 401) onExpired();
        }
      } finally { loading = false; }
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [chatID]);
  const snapshot = review?.snapshot;
  return <section aria-label="Changes" className="mt-8 min-w-0 rounded-md border border-foreground/20 p-4">
    <h2 className="font-semibold">Changes</h2>
    {!!review?.pulls.items?.length && <ul aria-label="Pull requests" className="mt-3 space-y-2 text-sm">{review.pulls.items.map(p => <li key={p.url}><a className="underline underline-offset-4" href={p.url} target="_blank" rel="noreferrer">PR #{p.number}</a> · {p.draft && p.state === "open" ? "Draft" : p.state}</li>)}</ul>}
    {!!review?.pulls.items?.length && review.pulls.checkedAt && <p className="mt-2 text-xs text-muted-foreground">PR status last checked <time dateTime={review.pulls.checkedAt}>{new Date(review.pulls.checkedAt).toLocaleString()}</time>.</p>}
    {review?.pulls.error && <p role="status" className="mt-3 text-sm">{review.pulls.error}</p>}
    {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
    {review?.error && <p role="alert" className="mt-3 text-sm">{review.error}</p>}
    {!review && !error && <p role="status" className="mt-3 text-sm">Loading changes…</p>}
    {review && !snapshot && <p className="mt-3 text-sm">No successful review saved yet.</p>}
    {snapshot && <>
      <p role="status" className="mt-3 break-words text-xs text-muted-foreground">{review.stale || error ? "Saved review, possibly out of date" : "Latest saved review"} · <time dateTime={snapshot.capturedAt}>{new Date(snapshot.capturedAt).toLocaleString()}</time> · Base {snapshot.base.slice(0, 12)}</p>
      {!snapshot.files.length && <p className="mt-3 text-sm">No changes from the starting commit.</p>}
      <ul className="mt-4 space-y-3">{snapshot.files.map((f, i) => <li key={`${f.previous}:${f.path}`} className="min-w-0">
        <details className="rounded-md border border-foreground/20 p-3">
          <summary className="cursor-pointer break-all text-sm"><span className="mr-2 font-mono">{f.status}</span>{f.previous && <>{f.previous} → </>}{f.path}{f.binary ? " · Binary" : f.undisplayable ? " · Cannot display contents" : ""}</summary>
          {f.truncated && <p className="mt-3 text-sm">Diff exceeds the 1 MiB inline limit ({f.bytes.toLocaleString()} bytes). <a className="underline underline-offset-4" href={`/api/chats/${encodeURIComponent(chatID)}/changes/${i}/diff?snapshot=${encodeURIComponent(snapshot.id)}`}>Download full diff</a></p>}
          {f.diff && <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre font-mono text-xs leading-5">{f.diff}</pre>}
        </details>
      </li>)}</ul>
    </>}
  </section>;
}
