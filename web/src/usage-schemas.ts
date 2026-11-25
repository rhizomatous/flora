import { z } from "zod";

const totals = z.object({
  costUSD: z.number().nullable(),
  tokens: z.number(),
  steps: z.number(),
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});
const group = totals.extend({
  id: z.string(),
  label: z.string(),
  project: z.string(),
  lastActivity: z.string(),
});
const chatGroup = group.extend({ publicChatID: z.string().regex(/^[A-Z]+-[1-9]\d*$/u) });
export const usageReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  bucket: z.enum(["hour", "day"]),
  total: totals,
  series: z.array(group),
  projects: z.array(group),
  models: z.array(group),
  chats: z.array(chatGroup),
});
export type UsageReport = z.infer<typeof usageReportSchema>;
export type UsageGroup = z.infer<typeof group>;
