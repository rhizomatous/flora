import { Heading } from "@flora/florets";

import { pullAge } from "./pull-age";
import { PullPerson } from "./pull-person";
import type { Pull } from "./pull-schemas";
import { useChecksNow } from "./use-checks-now";

export function PullHeader({ pull, heading }: { pull: Pull; heading: string }) {
  const age = pullAge(pull.createdAt, useChecksNow());
  const repository = pull.repository ?? pull.url.split("/").slice(3, 5).join("/");
  return (
    <header>
      <Heading
        level={2}
        id={heading}
        className="text-xl leading-7 font-medium tracking-tight wrap-anywhere"
      >
        {pull.title ?? `Pull request #${pull.number}`}
      </Heading>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
        {(pull.author ?? "") !== "" && (
          <a
            href={`https://github.com/${encodeURIComponent(pull.author ?? "")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center rounded-sm text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <PullPerson name={pull.author ?? ""} avatar={pull.authorAvatar} />
          </a>
        )}
        <a
          href={pull.url}
          target="_blank"
          rel="noreferrer"
          title={`${repository} #${pull.number}`}
          className="border-l border-border pl-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          #{pull.number}
        </a>
        {age !== "" && (
          <time
            dateTime={pull.createdAt}
            title={new Date(pull.createdAt ?? "").toLocaleString()}
            className="border-l border-border pl-2"
          >
            {age}
          </time>
        )}
      </div>
    </header>
  );
}
