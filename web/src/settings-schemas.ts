import { z } from "zod";

export const preferencesSchema = z.object({
  cpus: z.number(),
  memoryBytes: z.number(),
  pidsLimit: z.number(),
  setupSeconds: z.number(),
  authorName: z.string(),
  authorEmail: z.string(),
  maxRunning: z.number(),
  activitySeconds: z.number(),
  inlineDiffBytes: z.number(),
  messageBytes: z.number(),
  sessionSeconds: z.number(),
  sound: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const diagnosticSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  message: z.string(),
});
export const settingsSchema = z.object({
  validation: diagnosticSchema.array().optional(),
  provider: z.string(),
  model: z.string(),
  githubConfigured: z.boolean(),
  providerConfigured: z.boolean(),
  preferences: preferencesSchema,
  maxRunningOverride: z.number().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
