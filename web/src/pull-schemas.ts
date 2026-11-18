import { z } from "zod";

const pullCheckSchema = z.object({
  key: z.string().optional(),
  name: z.string(),
  state: z.string(),
  url: z.string().optional(),
});
const pullChecksSchema = z.object({
  sha: z.string().optional(),
  items: z
    .array(pullCheckSchema)
    .nullable()
    .transform((items) => items ?? []),
  checkedAt: z.string().optional(),
  attemptedAt: z.string().optional(),
  error: z.string().optional(),
});

export const pullSchema = z.object({
  body: z.string().optional(),
  author: z.string().optional(),
  headRef: z.string().optional(),
  baseRef: z.string().optional(),
  headSHA: z.string().optional(),
  headCheckedAt: z.string().optional(),
  checks: pullChecksSchema.optional(),
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
