import { z } from "zod";

export const executionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  variant: z.string(),
});
export type Execution = z.infer<typeof executionSchema>;
