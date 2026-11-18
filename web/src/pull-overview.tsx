import { useId } from "react";

import {
  Button,
  Heading,
  GitBranchIcon,
  ChevronRightIcon,
  CheckIcon,
  MessageSquareIcon,
  GitPullRequestIcon,
  ExternalLinkIcon,
} from "@flora/florets";
import { Markdown } from "@flora/florets/ai";

import { pullStatus } from "./pull";
import { PullChecksDetails, PullChecksLabel } from "./pull-checks";
import { PullLineCounts, PullStatusIcon } from "./pull-links";
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
  const repository = pull.repository ?? pull.url.split("/").slice(3, 5).join("/");
  return (
    <section
      aria-labelledby={heading}
      className="min-h-0 flex-1 overflow-y-auto"
      data-pull-overview={pull.url}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <span className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm font-medium">
          Overview
        </span>
        <Button
          variant="secondary"
          size="sm"
          nativeButton={false}
          role="link"
          render={
            <a
              href={pull.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open PR #${pull.number} on GitHub`}
            />
          }
          aria-label={`Open PR #${pull.number} on GitHub`}
        >
          <ExternalLinkIcon /> GitHub
        </Button>
      </div>
      <div className="mx-auto w-full max-w-3xl px-5 pt-6 pb-10 sm:px-6 sm:pt-8">
        <header>
          <Heading
            level={2}
            id={heading}
            className="text-2xl leading-8 tracking-tight wrap-anywhere"
          >
            {pull.title ?? `Pull request #${pull.number}`}
          </Heading>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {(pull.author ?? "") !== "" && (
              <>
                <span className="font-medium text-foreground">{pull.author}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="wrap-anywhere">{repository}</span>
            <span aria-hidden="true">·</span>
            <span>#{pull.number}</span>
          </p>
        </header>
        <dl className="mt-9 grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-3 gap-y-5 text-sm">
          {(pull.headRef ?? "") !== "" && (
            <>
              <dt className="flex items-center gap-2 text-muted-foreground">
                <GitBranchIcon className="size-4" />
                Branch
              </dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 wrap-anywhere">{pull.headRef}</span>
                <ChevronRightIcon
                  className="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="wrap-anywhere">{pull.baseRef ?? ""}</span>
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
