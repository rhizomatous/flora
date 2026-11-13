import {
  ExternalLinkIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "@flora/florets";

import type { Pull, PullSummary } from "./pull";

const appearances = {
  open: {
    label: "Open",
    Icon: GitPullRequestIcon,
    color: "text-emerald-700 dark:text-emerald-400",
  },
  draft: { label: "Draft", Icon: GitPullRequestDraftIcon, color: "text-muted-foreground" },
  merged: { label: "Merged", Icon: GitMergeIcon, color: "text-violet-700 dark:text-violet-400" },
  closed: {
    label: "Closed",
    Icon: GitPullRequestClosedIcon,
    color: "text-red-700 dark:text-red-400",
  },
  unknown: { label: "Unknown", Icon: GitPullRequestIcon, color: "text-muted-foreground" },
};

function appearance(pull: { state: string; draft: boolean }) {
  if (pull.state === "open") return pull.draft ? appearances.draft : appearances.open;
  if (pull.state === "merged") return appearances.merged;
  if (pull.state === "closed") return appearances.closed;
  return appearances.unknown;
}

export function PullCount({ pulls }: { pulls: Pull[] }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {Object.values(appearances).map(({ label, Icon, color }) => {
        const count = pulls.filter((pull) => appearance(pull).label === label).length;
        return count > 0 ? (
          <span
            key={label}
            role="img"
            className={`inline-flex items-center gap-1 text-xs ${color}`}
            aria-label={`${count} ${label.toLowerCase()} pull ${count === 1 ? "request" : "requests"}`}
            title={`${count} ${label.toLowerCase()} pull ${count === 1 ? "request" : "requests"}`}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span aria-hidden="true">{count}</span>
          </span>
        ) : null;
      })}
    </span>
  );
}

export function PullList({ summary }: { summary: PullSummary | undefined }) {
  const pulls = summary?.items ?? [];
  const error = summary?.error ?? "";
  let emptyMessage = "No linked pull requests yet.";
  if (summary === undefined) emptyMessage = "Loading pull requests…";
  else if (error !== "") emptyMessage = "Pull requests unavailable.";
  return (
    <div className="min-w-0 text-xs">
      {pulls.length > 0 ? (
        <ul aria-label="Linked pull requests" className="max-h-56 space-y-1 overflow-y-auto">
          {pulls.map((pull) => {
            const { Icon, color, label } = appearance(pull);
            const repository = pull.repository ?? pull.url.split("/").slice(3, 5).join("/");
            return (
              <li key={pull.url}>
                <a
                  href={pull.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-2 rounded-md p-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  data-pr-state={label.toLowerCase()}
                >
                  <Icon className={`size-4 shrink-0 ${color}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-words">
                    {pull.title !== undefined && (
                      <span className="block font-medium">{pull.title}</span>
                    )}
                    <span className="block text-muted-foreground">
                      {repository} #{pull.number}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={color}>{label}</span>
                    {pull.additions !== undefined && pull.deletions !== undefined && (
                      <span
                        className="mt-0.5 flex justify-end gap-1.5 tabular-nums"
                        role="img"
                        aria-label={`${pull.additions} additions, ${pull.deletions} deletions`}
                      >
                        <span className="text-emerald-700 dark:text-emerald-400" aria-hidden="true">
                          +{pull.additions}
                        </span>
                        <span className="text-red-700 dark:text-red-400" aria-hidden="true">
                          −{pull.deletions}
                        </span>
                      </span>
                    )}
                  </span>
                  <ExternalLinkIcon
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-2 text-muted-foreground">{emptyMessage}</p>
      )}
      {error !== "" && (
        <p role="status" className="mt-2 text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
