import { z } from "zod";

export const mcpSchema = z.object({
  name: z.string(),
  url: z.string(),
  enabled: z.boolean(),
  timeout: z.number(),
  headerNames: z
    .array(z.string())
    .nullable()
    .transform((value) => value ?? []),
});
export const mcpDiagnosticSchema = z.object({
  name: z.string(),
  status: z.string(),
  message: z.string(),
  tools: z.array(z.string()),
});
export type MCPServer = z.infer<typeof mcpSchema>;
export type MCPDiagnostic = z.infer<typeof mcpDiagnosticSchema>;
