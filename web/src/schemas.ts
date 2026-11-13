import { z } from "zod";

export const authenticatedSchema = z.object({ authenticated: z.boolean() });
export const statusSchema = authenticatedSchema.extend({
  setupRequired: z.boolean(),
  enrollmentRequired: z.boolean().default(false),
});
export type Status = z.infer<typeof statusSchema>;

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
export const settingsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  githubConfigured: z.boolean(),
  providerConfigured: z.boolean(),
  preferences: preferencesSchema,
  maxRunningOverride: z.number().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const diagnosticSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  message: z.string(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const repositorySchema = z.object({
  name: z.string(),
  url: z.string(),
  baseBranch: z.string(),
  role: z.enum(["core", "extra"]),
});
export type Repository = z.infer<typeof repositorySchema>;
export const projectSummarySchema = z.object({ id: z.string(), name: z.string() });
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export const projectSchema = projectSummarySchema.extend({
  configuration: z.object({ repositories: z.array(repositorySchema), setupCommand: z.string() }),
});
export type Project = z.infer<typeof projectSchema>;

export const chatSchema = z.object({
  ID: z.string(),
  ProjectID: z.string(),
  Title: z.string(),
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
export const detailSchema = z.object({
  chat: chatSchema,
  messages: z.array(messageSchema),
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

export const fileChangeSchema = z.object({
  repository: z.string().optional(),
  path: z.string(),
  previous: z.string().optional(),
  status: z.string(),
  binary: z.boolean(),
  undisplayable: z.boolean(),
  diff: z.string(),
  bytes: z.number(),
  truncated: z.boolean(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;
export const pullSchema = z.object({
  repository: z.string().optional(),
  url: z.string(),
  number: z.number(),
  state: z.string(),
  draft: z.boolean(),
});
export type Pull = z.infer<typeof pullSchema>;
const snapshotSchema = z.object({
  id: z.string(),
  capturedAt: z.string(),
  base: z.string(),
  bases: z.record(z.string(), z.string()).optional(),
  files: z.array(fileChangeSchema),
});
export const reviewSchema = z.object({
  snapshot: snapshotSchema.nullable(),
  stale: z.boolean(),
  error: z.string(),
  // Go encodes an uninitialized pull list as null. Consumers always receive an array.
  pulls: z.object({
    items: z
      .array(pullSchema)
      .nullable()
      .transform((items) => items ?? []),
    error: z.string(),
    checkedAt: z.string(),
  }),
});
export type Review = z.infer<typeof reviewSchema>;
