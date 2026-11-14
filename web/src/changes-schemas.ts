import { z } from "zod";

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
export const pullSchema = z.object({
  repository: z.string().optional(),
  url: z.string(),
  number: z.number(),
  state: z.string(),
  draft: z.boolean(),
});
export type Pull = z.infer<typeof pullSchema>;
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
  // Go encodes an uninitialized pull list as null. Consumers always receive an array.
  pulls: z.object({
    items: z
      .array(pullSchema)
      .nullable()
      .transform((items) => items ?? []),
    error: z.string(),
    checkedAt: z.string(),
  }),
});
export type ChatChanges = z.infer<typeof chatChangesSchema>;
