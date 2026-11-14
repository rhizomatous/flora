import { z } from "zod";

import { pullSummarySchema } from "./pull-schemas";

export const fileChangeSchema = z.object({
  repository: z.string().optional(),
  path: z.string(),
  previous: z.string().optional(),
  status: z.string(),
  binary: z.boolean(),
  undisplayable: z.boolean(),
  diff: z.string(),
  bytes: z.number(),
  truncated: z.boolean(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;
const snapshotSchema = z.object({
  id: z.string(),
  capturedAt: z.string(),
  base: z.string(),
  bases: z.record(z.string(), z.string()).optional(),
  files: z.array(fileChangeSchema),
});
export const chatChangesSchema = z.object({
  snapshot: snapshotSchema.nullable(),
  stale: z.boolean(),
  error: z.string(),
  pulls: pullSummarySchema,
});
export type ChatChanges = z.infer<typeof chatChangesSchema>;
