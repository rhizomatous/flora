export type PullState = "open" | "closed" | "merged";

export type Pull = {
  repository?: string;
  url: string;
  number: number;
  state: PullState;
  draft: boolean;
};
