import { z } from "zod";

export const modelOptionSchema = z.object({
  provider: z.string(),
  id: z.string(),
  name: z.string(),
  variants: z.array(z.string()),
  image: z.boolean(),
  pdf: z.boolean(),
  inputPrice: z.number().nonnegative().nullable().default(null),
  outputPrice: z.number().nonnegative().nullable().default(null),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;
