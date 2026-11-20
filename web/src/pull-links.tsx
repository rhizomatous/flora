import { useId, type ReactNode } from "react";

import {
  Card,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "@flora/florets";

import { pullAppearance } from "./pull-appearance";
import { PullChecksLabel } from "./pull-checks";
import { openPull, usePullNavigation } from "./pull-navigation";
import type { Pull, PullSummary } from "./pull-schemas";
import { useChecksNow } from "./use-checks-now";

const icons = {
  open: GitPullRequestIcon,
  draft: GitPullRequestDraftIcon,
  merged: GitMergeIcon,
  closed: GitPullRequestClosedIcon,
  unknown: GitPullRequestIcon,
};

function appearance(pull: Pull, now: number) {
  const result = pullAppearance(pull, now);
  return { ...result, Icon: icons[result.status] };
}

export function PullStatusIcon({ pull }: { pull: Pull }) {
  const { Icon, color, description, tone } = appearance(pull, useChecksNow());
  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className={color}
      data-pr-tone={tone}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
    </span>
  );
}

export function PullLineCounts({ pull }: { pull: Pull }) {
  if (pull.additions === undefined || pull.deletions === undefined) return null;
  return (
    <span
      className="flex shrink-0 gap-1.5 text-xs tabular-nums"
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
  );
}

export function PullCount({ pulls }: { pulls: Pull[] }) {
  const id = useId();
  const now = useChecksNow();
  const groups = new Map<string, Pull[]>();
  for (const pull of pulls) {
    const { status, tone } = appearance(pull, now);
    const key = `${status}:${tone}`;
    groups.set(key, [...(groups.get(key) ?? []), pull]);
  }
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {[...groups].map(([key, group]) => {
        const [first] = group;
        if (first === undefined) return null;
        const { label, Icon, color, tone } = appearance(first, now);
        const count = group.length;
        const description = group
          .map((pull) => `#${pull.number}: ${appearance(pull, now).description}`)
          .join("; ");
        return (
          <span key={key} className="contents">
            <span
              role="img"
              className={`inline-flex items-center gap-1 text-xs ${color}`}
              data-pr-tone={tone}
              aria-label={`${count} ${label.toLowerCase()} pull ${count === 1 ? "request" : "requests"}`}
              aria-describedby={`${id}-${key}`}
              title={description}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span aria-hidden="true">{count}</span>
            </span>
            <span className="sr-only" id={`${id}-${key}`}>
              {description}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function PullList({
  summary,
  checks = "none",
  chatID,
}: {
  summary: PullSummary | undefined;
  checks?: "none" | "summary";
  chatID?: string | undefined;
}) {
  const id = useId();
  const now = useChecksNow();
  const navigation = usePullNavigation(chatID);
  const pulls = summary?.items ?? [];
  const error = summary?.error ?? "";
  let emptyMessage = "No linked pull requests yet.";
  if (summary === undefined) emptyMessage = "Loading pull requests…";
  else if (error !== "") emptyMessage = "Pull requests unavailable.";
  return (
    <div className="max-h-[60dvh] min-w-0 overflow-y-auto text-xs">
      {pulls.length > 0 ? (
        <ul aria-label="Linked pull requests" className="space-y-2">
          {pulls.map((pull) => {
            const { Icon, color, label, description, tone } = appearance(pull, now);
            const repository = pull.repository ?? pull.url.split("/").slice(3, 5).join("/");
            return (
              <li key={pull.url}>
                <a
                  href={pull.url}
                  onClick={(event) => {
                    openPull(event, pull, navigation);
                  }}
                  aria-label={`${repository} #${pull.number} ${label}${(pull.title ?? "") === "" ? "" : `: ${pull.title}`}${pull.additions !== undefined && pull.deletions !== undefined ? `, ${pull.additions} additions, ${pull.deletions} deletions` : ""}`}
                  aria-describedby={`${id}-${pull.url}`}
                  title={`${repository} #${pull.number}, ${description}${(pull.title ?? "") === "" ? "" : `, ${pull.title}`}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-2 rounded-md p-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  data-pr-state={label.toLowerCase()}
                  data-pr-tone={tone}
                >
                  <Icon className={`size-3.5 shrink-0 ${color}`} aria-hidden="true" />
                  <span className="shrink-0 font-medium">#{pull.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {pull.title ?? repository}
                  </span>
                  <PullLineCounts pull={pull} />
                </a>
                <span className="sr-only" id={`${id}-${pull.url}`}>
                  {description}
                </span>
                {checks !== "none" && (
                  <div className="px-2 pb-1">
                    <PullChecksLabel pull={pull} />
                  </div>
                )}
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

export function InlinePullLink({
  pull,
  href,
  children,
}: {
  pull: Pull;
  href: string;
  children: ReactNode;
}) {
  const id = useId();
  const navigation = usePullNavigation();
  const { Icon, color, label, description, tone } = appearance(pull, useChecksNow());
  const repository = pull.repository ?? pull.url.split("/").slice(3, 5).join("/");
  return (
    <HoverCard>
      <span className="sr-only" id={id}>
        {description}
      </span>
      <HoverCardTrigger
        render={
          <a
            href={href}
            onClick={(event) => {
              openPull(event, pull, navigation);
            }}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full cursor-pointer items-baseline gap-1 rounded-sm align-baseline font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`${repository} #${pull.number} ${label}`}
            aria-describedby={id}
            title={`${repository} #${pull.number}, ${description}${(pull.title ?? "") === "" ? "" : `, ${pull.title}`}`}
            data-inline-pr={label.toLowerCase()}
            data-pr-tone={tone}
          />
        }
      >
        <Icon className={`size-3.5 shrink-0 self-center ${color}`} aria-hidden="true" />
        <span className="min-w-0 break-words">{children}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-96! max-w-[calc(100vw-24px)]!" density="compact">
        <p className="text-xs text-muted-foreground">
          {repository} #{pull.number}, {label}
        </p>
        <p className="mt-1 mb-2 text-sm">{pull.title}</p>
        <PullLineCounts pull={pull} />
        <PullChecksLabel pull={pull} />
      </HoverCardContent>
    </HoverCard>
  );
}

export function PullEventCard({ pull, opened }: { pull: Pull; opened: boolean }) {
  const navigation = usePullNavigation();
  const { Icon, color, tone, description } = appearance(pull, useChecksNow());
  const repository = (pull.repository ?? pull.url.split("/").slice(3, 5).join("/"))
    .split("/")
    .at(-1);
  return (
    <Card
      size="sm"
      className="mt-2.5 gap-2 rounded-lg px-3 py-3"
      aria-label={`Pull request #${pull.number}`}
      data-pull-event={pull.url}
    >
      <p className="text-xs text-muted-foreground">
        {opened ? "Opened" : "Pull request"} {repository}#{pull.number}
      </p>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          openPull(event, pull, navigation);
        }}
        title={description}
        className="flex min-w-0 items-center gap-2 rounded-sm text-[13px] leading-[18px] focus-visible:outline-2 focus-visible:outline-ring"
        data-pr-tone={tone}
      >
        <Icon className={`size-3.5 shrink-0 ${color}`} aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">
          {repository}#{pull.number}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{pull.title ?? "Pull request"}</span>
        <PullLineCounts pull={pull} />
      </a>
    </Card>
  );
}
