import { z } from "zod";

import { executionSchema } from "./execution-schema";

export const automationRunSchema = z.object({
  id: z.string(),
  automationID: z.string(),
  scheduledAt: z.string(),
  status: z.string(),
  reason: z.string(),
  chatID: z.string(),
  messageID: z.string(),
});

export const automationSchema = z.object({
  id: z.string(),
  projectID: z.string(),
  name: z.string(),
  instructions: z.string(),
  execution: executionSchema.nullable().optional(),
  description: z.string().max(2000).optional(),
  mode: z.enum(["new", "same"]),
  frequency: z.enum(["daily", "weekdays", "weekly"]),
  days: z.array(z.number()).nullable(),
  time: z.string(),
  timeZone: z.string(),
  enabled: z.boolean(),
  nextRun: z.string(),
  chatID: z.string(),
  revision: z.number(),
  latestRun: automationRunSchema.optional(),
});
export type Automation = z.infer<typeof automationSchema>;
export const automationDetailSchema = z.object({
  automation: automationSchema,
  runs: z.array(automationRunSchema),
});
export type AutomationDetail = z.infer<typeof automationDetailSchema>;
export const nextRunSchema = z.object({ nextRun: z.string() });
