import { useId } from "react";

import {
  GitBranchIcon,
  ChevronRightIcon,
  CheckIcon,
  MessageSquareIcon,
  GitPullRequestIcon,
  UsersIcon,
  TagIcon,
  CircleDotIcon,
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
      <div className="mx-auto w-full max-w-3xl px-5 pt-4 pb-8 sm:px-6 sm:pt-5">
        <PullHeader pull={pull} heading={heading} />
        <dl className="mt-7 grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 gap-y-4 text-[13px] leading-[18px]">
          {(pull.headRef ?? "") !== "" && (
            <>
              <dt className="flex items-center gap-2 text-muted-foreground">
                <GitBranchIcon className="size-3.5" />
                Branch
              </dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate" title={`PR branch: ${pull.headRef ?? ""}`}>
                  {pull.headRef}
                </span>
                <ChevronRightIcon
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">into</span>
                <span
                  className="max-w-20 shrink-0 truncate"
                  title={`Target branch: ${pull.baseRef ?? ""}`}
                >
                  {pull.baseRef ?? ""}
                </span>
                <PullLineCounts pull={pull} />
              </dd>
            </>
          )}
          <dt className="flex items-center gap-2 text-muted-foreground">
            <GitPullRequestIcon className="size-3.5" />
            Status
          </dt>
          <dd className="flex items-center gap-2">
            <PullStatusIcon pull={pull} />
            {statuses[pullStatus(pull)]}
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <UsersIcon className="size-3.5" />
            Reviewers
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-2">
            {(pull.reviewers?.length ?? 0) > 0 ? (
              pull.reviewers?.map((reviewer) => (
                <PullPerson key={reviewer.name} name={reviewer.name} avatar={reviewer.avatar} />
              ))
            ) : (
              <span className="text-muted-foreground">
                {pull.metadataKnown === true ? "No review requests" : "Unavailable"}
              </span>
            )}
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <TagIcon className="size-3.5" />
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
              <span className="text-muted-foreground">
                {pull.metadataKnown === true ? "No labels" : "Unavailable"}
              </span>
            )}
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <CheckIcon className="size-3.5" />
            Checks
          </dt>
          <dd>
            <a
              href={`#${checks}`}
              aria-describedby={`${checks}-revision`}
              title={`Head ${pull.headSHA ?? "unavailable"}${(pull.checks?.checkedAt ?? "") === "" ? "" : `, saved ${new Date(pull.checks?.checkedAt ?? "").toLocaleString()}`}`}
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
            <MessageSquareIcon className="size-3.5" />
            Chat
          </dt>
          <dd className="min-w-0 wrap-anywhere">{chatTitle || chatID}</dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <CircleDotIcon className="size-3.5" />
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
        <div className="mt-8">
          <details open className="group">
            <summary className="mb-2 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-[13px] leading-5 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
              Description{" "}
              <ChevronRightIcon
                className="size-3 rotate-0 group-open:rotate-90"
                aria-hidden="true"
              />
            </summary>
            {(pull.body ?? "") === "" ? (
              <p className="text-[13px] leading-5 text-muted-foreground">No description.</p>
            ) : (
              <div className="text-[13px] leading-5 wrap-anywhere" data-pull-description>
                <Markdown
                  mode="static"
                  className="space-y-3! [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-sm"
                >
                  {pull.body ?? ""}
                </Markdown>
              </div>
            )}
          </details>
        </div>
        <div className="mt-8 scroll-mt-4" id={checks}>
          <PullChecksDetails pull={pull} error={error} />
        </div>
      </div>
    </section>
  );
}
