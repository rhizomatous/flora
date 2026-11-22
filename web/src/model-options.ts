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

export function matchModel(value: string, query: string, keywords: string[] = []) {
  const content = [value, ...keywords].join(" ").toLowerCase();
  const compact = content.replaceAll(/[^\p{L}\p{N}]/gu, "");
  const terms = query.trim().toLowerCase().split(/\s+/u);
  return terms.every((term) => {
    const normalized = term.replaceAll(/[^\p{L}\p{N}]/gu, "");
    return content.includes(term) || (normalized !== "" && compact.includes(normalized));
  });
}
