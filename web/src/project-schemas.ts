import { z } from "zod";

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
