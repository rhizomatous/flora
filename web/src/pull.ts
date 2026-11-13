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
