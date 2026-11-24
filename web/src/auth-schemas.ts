import { z } from "zod";

export const authenticatedSchema = z.object({ authenticated: z.boolean() });
export const statusSchema = authenticatedSchema.extend({
  setupRequired: z.boolean(),
  recoveryAuthorized: z.boolean().default(false),
  passwordAvailable: z.boolean().default(true),
  passkeysAvailable: z.boolean().default(false),
  passkeyError: z.string().default(""),
  setupAuthorized: z.boolean().default(false),
});
export type Status = z.infer<typeof statusSchema>;
