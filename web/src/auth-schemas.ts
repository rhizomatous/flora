import { z } from "zod";

export const authenticatedSchema = z.object({ authenticated: z.boolean() });
export const statusSchema = authenticatedSchema.extend({
  setupRequired: z.boolean(),
  enrollmentRequired: z.boolean().default(false),
});
export type Status = z.infer<typeof statusSchema>;
