import { z } from "zod";

export const setupSteps = ["account", "model", "github", "project", "finish"] as const;
export const onboardingSchema = z.object({
  started: z.boolean(),
  step: z.enum(setupSteps),
  completed: z.boolean(),
  projectID: z.string(),
});
export type OnboardingState = z.infer<typeof onboardingSchema>;
export type SetupStep = OnboardingState["step"];
export function setupStep(path: string, fallback: SetupStep): SetupStep {
  const candidate = path.split("/")[1];
  return setupSteps.find((step) => step === candidate) ?? fallback;
}
