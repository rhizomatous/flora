import { z } from "zod";

const githubURL = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    url.username === "" &&
    url.password === ""
  );
});

const installationSchema = z.object({
  html_url: githubURL.optional(),
  id: z.number(),
  account: z.object({ login: z.string() }),
  suspended_at: z.string().nullable(),
});
export const connectionSchema = z.object({
  state: z.string(),
  slug: z.string(),
  account: z.string(),
  installationID: z.number(),
  active: z.string(),
  installations: installationSchema.array(),
});
export const startSchema = z.object({ url: z.url(), manifest: z.string().optional() });
export const okSchema = z.object({ ok: z.boolean() });
const repositorySchema = z.object({
  full_name: z.string(),
  html_url: githubURL,
  default_branch: z.string(),
});
export const repositoryPageSchema = z.object({
  repositories: repositorySchema.array(),
  nextPage: z.number(),
});
export type GitHubRepository = z.infer<typeof repositoryPageSchema>["repositories"][number];
