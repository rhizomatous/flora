import { z } from "zod";

export const setupSteps = ["account", "model", "github", "project"] as const;
export const onboardingSchema = z.object({
  started: z.boolean(),
  step: z
    .enum([...setupSteps, "finish"])
    .transform((step) => (step === "finish" ? "project" : step)),
  completed: z.boolean(),
  projectID: z.string(),
});
export type OnboardingState = z.infer<typeof onboardingSchema>;
export type SetupStep = OnboardingState["step"];
export function setupStep(path: string, fallback: SetupStep): SetupStep {
  const requested = path.split("/")[1];
  const candidate = requested === "finish" ? "project" : requested;
  return setupSteps.find((step) => step === candidate) ?? fallback;
}
