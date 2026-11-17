import { useEffect, useState } from "react";

import { CheckIcon, XIcon, ClockIcon, CircleDotIcon, ChevronDownIcon } from "@flora/florets";

import { pullChecksSummary } from "./pull-checks-summary";
import type { Pull } from "./pull-schemas";

const tones: Record<string, string> = {
  success: "text-emerald-700 dark:text-emerald-400",
  failure: "text-red-700 dark:text-red-400",
  pending: "text-amber-700 dark:text-amber-400",
};
function CheckState({ state }: { state: string }) {
  const Icon =
    (
      { success: CheckIcon, failure: XIcon, pending: ClockIcon } as Record<string, typeof CheckIcon>
    )[state] ?? CircleDotIcon;
  return (
    <Icon
      aria-hidden="true"
      className={`size-3.5 shrink-0 ${tones[state] ?? "text-muted-foreground"}`}
    />
  );
}
export function PullChecksLabel({ pull }: { pull: Pull }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const { label, state, stale } = pullChecksSummary(pull, now);
  let prefix = "";
  if (stale && (pull.checks?.checkedAt ?? "") !== "") {
    prefix = "Saved: ";
  }
  if (pull.checks?.sha !== undefined && pull.checks.sha !== pull.headSHA) {
    prefix = "Previous head: ";
  }
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      data-check-state={state}
    >
      <CheckState state={state} />
      <span>
        {prefix}
        {label}
      </span>
    </span>
  );
}
export function PullChecksDetails({ pull }: { pull: Pull }) {
  const { checks } = pull;
  const previous = (checks?.sha ?? "") !== "" && checks?.sha !== pull.headSHA;
  return (
    <details className="group min-w-0 text-xs" data-pull-checks>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1.5 focus-visible:outline-2 focus-visible:outline-ring">
        <PullChecksLabel pull={pull} />
        <ChevronDownIcon
          aria-hidden="true"
          className="ml-auto size-3.5 shrink-0 text-muted-foreground group-open:rotate-180"
        />
      </summary>
      <div className="space-y-2 pt-1 pb-2 text-muted-foreground">
        <p className="wrap-anywhere">
          Head <code title={pull.headSHA}>{pull.headSHA?.slice(0, 7) ?? "unavailable"}</code>
          {previous && (
            <>
              {" "}
              · Saved checks for previous head{" "}
              <code title={checks?.sha}>{checks?.sha?.slice(0, 7)}</code>
            </>
          )}
        </p>
        {(checks?.checkedAt ?? "") !== "" && (
          <p>
            Saved{" "}
            <time dateTime={checks?.checkedAt}>
              {new Date(checks?.checkedAt ?? "").toLocaleString()}
            </time>
          </p>
        )}
        {(checks?.error ?? "") !== "" && <p role="status">{checks?.error}</p>}
        {(checks?.items.length ?? 0) > 0 && (
          <ul aria-label={`Checks for PR #${pull.number}`} className="space-y-1">
            {checks?.items.map((item) => (
              <li
                key={item.key ?? `${item.name}-${item.url ?? ""}`}
                className="flex min-w-0 items-center gap-2 py-1"
              >
                <CheckState state={item.state} />
                {(item.url ?? "") === "" ? (
                  <span className="min-w-0 flex-1 break-words">{item.name}</span>
                ) : (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 rounded-sm break-words text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {item.name}
                  </a>
                )}
                <span className="shrink-0">
                  {(
                    {
                      success: "Passed",
                      failure: "Failed",
                      pending: "Pending",
                      neutral: "Skipped",
                    } as Record<string, string>
                  )[item.state] ?? "Unavailable"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
