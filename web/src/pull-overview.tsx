import { useId } from "react";

import {
  GitBranchIcon,
  ChevronRightIcon,
  CheckIcon,
  MessageSquareIcon,
  GitPullRequestIcon,
  ExternalLinkIcon,
  UsersIcon,
  TagIcon,
  CircleDotIcon,
  PlusIcon,
} from "@flora/florets";
import { Markdown } from "@flora/florets/ai";

import { pullStatus } from "./pull";
import { PullActions } from "./pull-actions";
import { PullChecksDetails, PullChecksLabel } from "./pull-checks";
import { PullHeader } from "./pull-header";
import { PullLineCounts, PullStatusIcon } from "./pull-links";
import { PullPerson } from "./pull-person";
import type { Pull } from "./pull-schemas";

const statuses = {
  open: "Ready for review",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  unknown: "Unknown",
};

export function PullOverview({
  pull,
  chatID,
  chatTitle,
  error,
}: {
  pull: Pull;
  chatID: string;
  chatTitle: string;
  error: string;
}) {
  const heading = useId();
  const checks = useId();
  return (
    <section
      aria-labelledby={heading}
      className="min-h-0 flex-1 overflow-y-auto"
      data-pull-overview={pull.url}
    >
      <PullActions pull={pull} />
      <div className="mx-auto w-full max-w-3xl px-5 pt-6 pb-10 sm:px-6 sm:pt-8">
        <PullHeader pull={pull} heading={heading} />
        <dl className="mt-9 grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 gap-y-5 text-sm">
          {(pull.headRef ?? "") !== "" && (
            <>
              <dt className="flex items-center gap-2 text-muted-foreground">
                <GitBranchIcon className="size-4" />
                Branch
              </dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate" title={pull.headRef}>
                  {pull.headRef}
                </span>
                <ChevronRightIcon
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="max-w-20 shrink-0 truncate" title={pull.baseRef}>
                  {pull.baseRef ?? ""}
                </span>
                <PullLineCounts pull={pull} />
              </dd>
            </>
          )}
          <dt className="flex items-center gap-2 text-muted-foreground">
            <GitPullRequestIcon className="size-4" />
            Status
          </dt>
          <dd className="flex items-center gap-2">
            <PullStatusIcon pull={pull} />
            {statuses[pullStatus(pull)]}
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <UsersIcon className="size-4" />
            Reviewers
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-2">
            {(pull.reviewers?.length ?? 0) > 0 ? (
              pull.reviewers?.map((reviewer) => (
                <PullPerson key={reviewer.name} name={reviewer.name} avatar={reviewer.avatar} />
              ))
            ) : (
              <a
                href={pull.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Add reviewers on GitHub"
                className="inline-flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <PlusIcon className="size-4" />
                {pull.metadataKnown === true ? "Add reviewers" : "View reviewers"}
                <ExternalLinkIcon className="size-3 text-muted-foreground/60" />
              </a>
            )}
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <TagIcon className="size-4" />
            Labels
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-2">
            {(pull.labels?.length ?? 0) > 0 ? (
              pull.labels?.map((label) => (
                <span key={label} className="rounded-full border border-border px-2 py-0.5 text-xs">
                  {label}
                </span>
              ))
            ) : (
              <a
                href={pull.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Add labels on GitHub"
                className="inline-flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <PlusIcon className="size-4" />
                {pull.metadataKnown === true ? "Add labels" : "View labels"}
                <ExternalLinkIcon className="size-3 text-muted-foreground/60" />
              </a>
            )}
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <CheckIcon className="size-4" />
            Checks
          </dt>
          <dd>
            <a
              href={`#${checks}`}
              aria-describedby={`${checks}-revision`}
              title={`Head ${pull.headSHA ?? "unavailable"}${(pull.checks?.checkedAt ?? "") === "" ? "" : ` · Saved ${new Date(pull.checks?.checkedAt ?? "").toLocaleString()}`}`}
              onClick={(event) => {
                event.preventDefault();
                document
                  .querySelector(`#${CSS.escape(checks)}`)
                  ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
              className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              <PullChecksLabel pull={pull} size="default" />
            </a>
            <span className="sr-only" id={`${checks}-revision`}>
              PR head {pull.headSHA ?? "unavailable"}. Saved checks for{" "}
              {pull.checks?.sha ?? "unavailable"}.
            </span>
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <MessageSquareIcon className="size-4" />
            Chat
          </dt>
          <dd className="min-w-0 wrap-anywhere">{chatTitle || chatID}</dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <CircleDotIcon className="size-4" />
            Issues
          </dt>
          <dd className="min-w-0 space-y-1">
            {(pull.issues?.items.length ?? 0) > 0 ? (
              pull.issues?.items.map((issue) => (
                <a
                  key={issue.url}
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-muted-foreground">#{issue.number}</span> {issue.title}
                </a>
              ))
            ) : (
              <span className="text-muted-foreground">
                {(pull.issues?.checkedAt ?? "") !== "" && (pull.issues?.error ?? "") === ""
                  ? "No issues"
                  : "Unavailable"}
              </span>
            )}
            {(pull.issues?.error ?? "") !== "" && (
              <p className="text-xs text-muted-foreground" role="status">
                {pull.issues?.error}
                {(pull.issues?.checkedAt ?? "") !== "" && (
                  <>
                    {" "}
                    Saved{" "}
                    <time dateTime={pull.issues?.checkedAt}>
                      {new Date(pull.issues?.checkedAt ?? "").toLocaleString()}
                    </time>
                    .
                  </>
                )}
              </p>
            )}
          </dd>
        </dl>
        <div className="mt-10">
          <details open className="group">
            <summary className="mb-3 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
              Description{" "}
              <ChevronRightIcon
                className="size-3 rotate-0 group-open:rotate-90"
                aria-hidden="true"
              />
            </summary>
            {(pull.body ?? "") === "" ? (
              <p className="text-sm text-muted-foreground">No description.</p>
            ) : (
              <div className="text-sm leading-6 wrap-anywhere">
                <Markdown>{pull.body ?? ""}</Markdown>
              </div>
            )}
          </details>
        </div>
        <div className="mt-10 scroll-mt-5" id={checks}>
          <PullChecksDetails pull={pull} error={error} />
        </div>
      </div>
    </section>
  );
}
