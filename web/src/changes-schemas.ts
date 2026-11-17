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
  additions: z.number().optional(),
  deletions: z.number().optional(),
  truncated: z.boolean(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;
export const snapshotSchema = z.object({
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

export function changeStatus(status: string) {
  return (
    (
      {
        A: "Added",
        D: "Deleted",
        R: "Renamed",
        C: "Copied",
        T: "Type changed",
        M: "Modified",
      } as Record<string, string>
    )[status[0] ?? ""] ?? status
  );
}
