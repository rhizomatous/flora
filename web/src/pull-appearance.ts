import { pullStatus } from "./pull";
import { pullChecksSummary } from "./pull-checks-summary";
import type { Pull } from "./pull-schemas";

export const pullTones = {
  neutral: "text-muted-foreground",
  success: "text-emerald-700 dark:text-emerald-400",
  pending: "text-amber-700 dark:text-amber-400",
  failure: "text-red-700 dark:text-red-400",
  merged: "text-violet-700 dark:text-violet-400",
};

export function pullAppearance(pull: Pull, now = Date.now()) {
  const status = pullStatus(pull);
  const checks = pullChecksSummary(pull, now);
  let tone: keyof typeof pullTones = "neutral";
  if (status === "open") {
    if (checks.state === "success") tone = "success";
    if (checks.state === "pending") tone = "pending";
    if (checks.state === "failure") tone = "failure";
  }
  if (status === "closed") tone = "failure";
  if (status === "merged") tone = "merged";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  let checkLabel = checks.label;
  if (checks.stale && (pull.checks?.checkedAt ?? "") !== "") {
    checkLabel = `Saved checks: ${checkLabel}`;
  }
  if ((pull.checks?.sha ?? "") !== "" && pull.checks?.sha !== pull.headSHA) {
    checkLabel = `Previous head: ${checks.label}`;
  }
  return { status, label, tone, color: pullTones[tone], description: `${label} · ${checkLabel}` };
}
