import { z } from "zod";

import { automationRunSchema } from "./automation-schemas";
import { executionSchema } from "./execution-schema";
import { pullSummarySchema } from "./pull-schemas";

export { executionSchema, type Execution } from "./execution-schema";

const subagentSummarySchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
});

export const chatSchema = z.object({
  Execution: executionSchema.optional(),
  pulls: pullSummarySchema.optional(),
  subagents: z.array(subagentSummarySchema).optional(),
  ID: z.string(),
  ProjectID: z.string(),
  Title: z.string(),
  PinnedAt: z.string().optional(),
  Archived: z.boolean().optional(),
  OrganizationRevision: z.number().int().nonnegative().optional(),
  Status: z.enum(["working", "waiting", "failed", "idle", "stopped"]),
  StatusReason: z.string(),
  UpdatedAt: z.string(),
  ImageDigest: z.string(),
  HarnessVersion: z.string(),
  StartingCommits: z.record(z.string(), z.string()),
});
export type Chat = z.infer<typeof chatSchema>;
const completionSchema = z.object({ ChatID: z.string(), Sequence: z.number().int().nonnegative() });
export type Completion = z.infer<typeof completionSchema>;
export const feedSchema = z.object({
  chats: z.array(chatSchema),
  completions: z.array(completionSchema),
  cursor: z.number().int().nonnegative(),
});

// These optional hints are read from arbitrary tool input only when choosing a display label.
// Non-string hints are ignored; the original input remains available in the tool details.
/* oxlint-disable promise/prefer-await-to-then, unicorn/prefer-top-level-await, unicorn/no-useless-undefined -- Zod catch supplies synchronous parse fallbacks, not Promise handlers. */
export const toolDisplayInputSchema = z
  .object({
    description: z.string().optional().catch(undefined),
    filePath: z.string().optional().catch(undefined),
  })
  .catch({});
/* oxlint-enable promise/prefer-await-to-then, unicorn/prefer-top-level-await, unicorn/no-useless-undefined */

const timeSchema = z.object({ start: z.number(), end: z.number().optional() });
// Runtime parts are extensible. Preserve extra fields for the raw-part display while parsing
// every field used by transcript rendering. Tool inputs and provider errors remain opaque.
export const partSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string(),
  text: z.string().optional(),
  tool: z.string().optional(),
  filename: z.string().optional(),
  mime: z.string().optional(),
  url: z.string().optional(),
  time: timeSchema.optional(),
  state: z
    .looseObject({
      time: timeSchema.optional(),
      status: z.string(),
      input: z.unknown().optional(),
      output: z.string().optional(),
      error: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
});
export type Part = z.infer<typeof partSchema>;
const messageInfoSchema = z.object({ error: z.unknown().optional() });
const payloadSchema = z.object({
  parts: z.array(partSchema).default([]),
  info: messageInfoSchema.optional(),
});
export const messageSchema = z.object({
  ID: z.string(),
  Role: z.string(),
  Text: z.string(),
  Provider: z.string(),
  Model: z.string(),
  Payload: payloadSchema,
});
export type Message = z.infer<typeof messageSchema>;
export const usageSchema = z.object({
  costUSD: z.number().nonnegative().nullable(),
  steps: z.number().int().nonnegative(),
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  checkedAt: z.string(),
  collection: z
    .enum(["pending", "complete", "history_unavailable", "runtime_stopped"])
    .default("pending"),
});
export type Usage = z.infer<typeof usageSchema>;
export const contextUsageSchema = z.object({
  tokens: z.number().int().nonnegative().nullable(),
  limit: z.number().int().positive().nullable(),
  provider: z.string(),
  model: z.string(),
});
export type ContextUsage = z.infer<typeof contextUsageSchema>;
export const subagentSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  parentID: z.string(),
  title: z.string(),
  status: z.enum(["unknown", "working", "waiting", "idle", "failed", "stopped"]),
  collection: z.string(),
  created: z.number(),
  updatedAt: z.string(),
});
export type Subagent = z.infer<typeof subagentSchema>;
export const subagentDetailSchema = z.object({ messages: z.array(messageSchema) });
export const detailSchema = z.object({
  automationRuns: z.array(automationRunSchema).default([]),
  usage: usageSchema.optional(),
  contextUsage: contextUsageSchema.optional(),
  chat: chatSchema,
  messages: z.array(messageSchema),
  subagents: z.array(subagentSchema).default([]),
  continuationBlockedReason: z.string().default(""),
});
export type Detail = z.infer<typeof detailSchema>;
export const acceptanceSchema = z.object({ Message: messageSchema, Duplicate: z.boolean() });
export const activitySchema = z.object({
  ChatID: z.string(),
  Sequence: z.number().int().nonnegative(),
  Kind: z.string(),
});
export type Activity = z.infer<typeof activitySchema>;
export const requestIdentitySchema = z.object({ body: z.string(), id: z.string() });

const optionSchema = z.object({ label: z.string(), description: z.string() });
const questionItemSchema = z.object({
  question: z.string(),
  header: z.string(),
  multiple: z.boolean().default(false),
  custom: z.boolean().default(true),
  options: z.array(optionSchema),
});
export const questionSchema = z.object({ id: z.string(), questions: z.array(questionItemSchema) });
export type Question = z.infer<typeof questionSchema>;
export const answeredSchema = z.object({ answered: z.literal(true) });
