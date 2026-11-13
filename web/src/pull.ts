export type PullState = "open" | "closed" | "merged";

export type Pull = {
  title?: string;
  additions?: number;
  deletions?: number;
  repository?: string;
  url: string;
  number: number;
  state: PullState;
  draft: boolean;
};

export type PullSummary = {
  items: Pull[] | null;
  checkedAt: string;
  error: string;
};

export function pullStatus(pull: { state: string; draft: boolean }) {
  if (pull.state === "open") return pull.draft ? "draft" : "open";
  if (pull.state === "merged") return "merged";
  if (pull.state === "closed") return "closed";
  return "unknown";
}
