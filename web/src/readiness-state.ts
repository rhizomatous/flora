import { z } from "zod";

import { onboardingSchema } from "./onboarding-state";

const readinessCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  ok: z.boolean(),
  message: z.string(),
  fixPath: z.string(),
  fixLabel: z.string(),
});
/** A fresh prerequisite check. Handoff requests rerun it; wizard completion and
 * successful chat activity are separate milestones. */
export const readinessSchema = z.object({
  checkedAt: z.string(),
  projectID: z.string(),
  ready: z.boolean(),
  checks: readinessCheckSchema.array(),
});
export type Readiness = z.infer<typeof readinessSchema>;
export const readinessResponseSchema = z.object({
  readiness: readinessSchema,
  onboarding: onboardingSchema,
});
