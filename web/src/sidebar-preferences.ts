/* oxlint-disable promise/prefer-await-to-then, unicorn/prefer-top-level-await -- Zod catch supplies defaults for invalid saved fields. */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  grouping: z.enum(["project", "status", "none"]).catch("project"),
  status: z.enum(["all", "working", "waiting", "idle", "failed", "stopped"]).catch("all"),
  project: z.string().catch(""),
  unread: z.boolean().catch(false),
  details: z.boolean().catch(true),
  collapsed: z.array(z.string()).catch([]),
});
export type SidebarPreferences = z.infer<typeof schema>;
export const sidebarPreferenceKey = "flora:sidebar-preferences:v1";
export const defaultSidebarPreferences = schema.parse({});

export function parseSidebarPreferences(raw: string | null): SidebarPreferences {
  try {
    return schema.parse(JSON.parse(raw ?? "{}"));
  } catch {
    return defaultSidebarPreferences;
  }
}

/** Saves browser-local navigation choices independently of chat and composer data. */
export function useSidebarPreferences() {
  const [preferences, setPreferences] = useState(() => {
    try {
      return parseSidebarPreferences(localStorage.getItem(sidebarPreferenceKey));
    } catch {
      return defaultSidebarPreferences;
    }
  });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === sidebarPreferenceKey || event.key === null) {
        setPreferences(parseSidebarPreferences(event.newValue));
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener("storage", changed);
    };
  }, []);
  const update = useCallback(
    (change: Partial<SidebarPreferences>) => {
      const next = { ...preferences, ...change };
      try {
        localStorage.setItem(sidebarPreferenceKey, JSON.stringify(next));
      } catch {
        toast.error("Could not save sidebar preferences in this browser.", {
          toasterId: "chat-organization",
          id: "sidebar-preferences",
        });
      }
      setPreferences(next);
    },
    [preferences],
  );
  return [preferences, update] as const;
}
