import { z } from "zod";

export const pullSchema = z.object({
  title: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  repository: z.string().optional(),
  url: z.string(),
  number: z.number(),
  // Unverified saved PRs can have an empty or unfamiliar state; the UI shows Unknown.
  state: z.string(),
  draft: z.boolean(),
});
export type Pull = z.infer<typeof pullSchema>;
// Go encodes an uninitialized pull list as null. Consumers always receive an array.
export const pullSummarySchema = z.object({
  items: z
    .array(pullSchema)
    .nullable()
    .transform((items) => items ?? []),
  error: z.string(),
  checkedAt: z.string(),
});
export type PullSummary = z.infer<typeof pullSummarySchema>;
