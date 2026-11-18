import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";

import { errorMessage, isExpired, request } from "./request";

const repositorySchema = z.object({ name: z.string(), role: z.string() });
export const repositoriesSchema = z.object({ repositories: z.array(repositorySchema) });
const entrySchema = z.object({ name: z.string(), kind: z.string() });
export const listingSchema = z.object({
  entries: z.array(entrySchema),
  truncated: z.boolean(),
  nextOffset: z.number(),
});
export const previewSchema = z.object({
  size: z.number(),
  version: z.string(),
  kind: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  downloadable: z.boolean(),
});

export function workspaceURL(
  chatID: string,
  file: { repository: string; path: string },
  { revision = 0, offset = 0 }: { revision?: number; offset?: number } = {},
) {
  const params = new URLSearchParams({
    repository: file.repository,
    path: file.path,
    revision: String(revision),
    offset: String(offset),
  });
  return `chats/${encodeURIComponent(chatID)}/workspace?${params}`;
}

/** Keeps only the response for this location and cancels reads when its pane is hidden. */
export function useWorkspaceResource<T>(
  schema: z.ZodType<T>,
  url: string,
  { active, onExpired, delay = 0 }: { active: boolean; onExpired: () => void; delay?: number },
) {
  const [result, setResult] = useState<{ url: string; data?: T; error: string }>();
  const expire = useEffectEvent(onExpired);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    async function load() {
      try {
        const data = await request(schema, url, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ url, data, error: "" });
      } catch (e) {
        if (!controller.signal.aborted) {
          setResult({ url, error: errorMessage(e, "Could not read workspace files.") });
          if (isExpired(e)) expire();
        }
      }
    }
    const timer = setTimeout(() => {
      void load();
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [schema, url, active, delay]);
  return result?.url === url ? result : { url, error: "" };
}
