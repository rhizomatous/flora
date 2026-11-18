import {
  CheckIcon,
  XIcon,
  ClockIcon,
  CircleDotIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
} from "@flora/florets";

import { pullChecksSummary } from "./pull-checks-summary";
import type { Pull } from "./pull-schemas";
import { useChecksNow } from "./use-checks-now";

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
export function PullChecksLabel({ pull, size = "sm" }: { pull: Pull; size?: "sm" | "default" }) {
  const now = useChecksNow();
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
      className={`inline-flex min-w-0 items-center gap-2 ${size === "sm" ? "text-xs" : "text-sm"} text-muted-foreground`}
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
export function PullChecksDetails({ pull, error = "" }: { pull: Pull; error?: string }) {
  const { checks } = pull;
  const { stale } = pullChecksSummary(pull, useChecksNow());
  const previous = (checks?.sha ?? "") !== "" && checks?.sha !== pull.headSHA;
  const warning = (checks?.error ?? "") === "" ? error : (checks?.error ?? "");
  return (
    <section aria-label="Checks" data-pull-checks>
      {stale && (
        <div
          className="mb-6 space-y-2 rounded-lg border border-border px-3 py-3 text-sm text-muted-foreground"
          role="status"
        >
          <p>{warning || "Saved checks may be out of date."}</p>
          {previous && (
            <p>
              Saved checks for previous head{" "}
              <code title={checks?.sha}>{checks?.sha?.slice(0, 7)}</code>.
            </p>
          )}
          {(pull.headSHA ?? "") !== "" && (
            <p>
              Current head <code title={pull.headSHA}>{pull.headSHA?.slice(0, 7)}</code>
            </p>
          )}
          {(checks?.checkedAt ?? "") !== "" && (
            <p>
              Saved{" "}
              <time dateTime={checks?.checkedAt}>
                {new Date(checks?.checkedAt ?? "").toLocaleString()}
              </time>
            </p>
          )}
        </div>
      )}
      <details open className="group">
        <summary className="mb-3 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
          Checks{" "}
          <ChevronDownIcon
            className="size-3 rotate-[-90deg] group-open:rotate-0"
            aria-hidden="true"
          />
        </summary>
        {(checks?.items.length ?? 0) === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {(checks?.checkedAt ?? "") === ""
              ? "Checks unavailable."
              : "No checks reported for this revision."}
          </p>
        ) : (
          <ul aria-label={`Checks for PR #${pull.number}`}>
            {checks?.items.map((item) => {
              const content = (
                <>
                  <CheckState state={item.state} />
                  <span className="min-w-0 flex-1 break-words">{item.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {(
                      {
                        success: "Passed",
                        failure: "Failed",
                        pending: "Pending",
                        neutral: "Skipped",
                      } as Record<string, string>
                    )[item.state] ?? "Unavailable"}
                  </span>
                </>
              );
              const rowClass = "flex min-w-0 items-center gap-3 rounded-md py-2.5 text-sm";
              return (
                <li key={item.key ?? `${item.name}-${item.url ?? ""}`}>
                  {(item.url ?? "") === "" ? (
                    <div className={rowClass}>
                      {content}
                      <span className="w-4" />
                    </div>
                  ) : (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`${rowClass} hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring`}
                    >
                      {content}
                      <ExternalLinkIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </section>
  );
}
