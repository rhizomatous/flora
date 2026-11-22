import { z } from "zod";

export const referenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    label: z.string(),
    repository: z.string(),
    path: z.string(),
  }),
  z.object({ kind: z.literal("chat"), label: z.string(), chatID: z.string() }),
  z.object({
    kind: z.literal("pr"),
    label: z.string(),
    repository: z.string(),
    number: z.number().int().positive(),
  }),
]);
export type ContextReference = z.infer<typeof referenceSchema>;
export function referenceKey(ref: ContextReference) {
  if (ref.kind === "file") return `file:${ref.repository}:${ref.path}`;
  if (ref.kind === "chat") return `chat:${ref.chatID}`;
  return `pr:${ref.repository}:${ref.number}`;
}
export function referenceLocation(ref: ContextReference) {
  if (ref.kind === "file") return `${ref.repository}/${ref.path}`;
  if (ref.kind === "chat") return "Chat";
  return `${ref.repository}#${ref.number}`;
}
