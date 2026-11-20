import { z } from "zod";

export const referenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["file", "chat", "pr"]),
  label: z.string(),
  source: z.string(),
  version: z.string(),
  capturedAt: z.string(),
});

export const savedReferenceSchema = referenceSchema.extend({ content: z.string().optional() });
