import { useSyncExternalStore } from "react";
import { z } from "zod";

const schema = z.object({
  open: z.boolean().default(false),
  diffOpen: z.boolean().default(false),
  view: z.string().default("overview"),
  subagentTabs: z.array(z.string()).default([]),
  width: z.number().min(1).max(99).default(40),
  pullsOpen: z.boolean().default(true),
});
export type ChatPanelState = z.infer<typeof schema>;
const states = new Map<string, ChatPanelState>();
const listeners = new Set<() => void>();
const key = (id: string) => `flora-panel:${id}`;

function read(id: string): ChatPanelState {
  const cached = states.get(id);
  if (cached) return cached;
  let state = schema.parse({});
  try {
    const raw = sessionStorage.getItem(key(id));
    const saved = schema.safeParse(JSON.parse(raw ?? "{}"));
    if (saved.success) state = saved.data;
  } catch {
    // Storage may be unavailable; in-memory state still survives navigation.
  }
  if (state.view === "diffs") state.diffOpen = true;
  states.set(id, state);
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatPanelState(id: string) {
  const state = useSyncExternalStore(subscribe, () => read(id));
  function update(patch: Partial<ChatPanelState>) {
    const next = { ...read(id), ...patch };
    states.set(id, next);
    try {
      sessionStorage.setItem(key(id), JSON.stringify(next));
    } catch {
      // Keep the controls usable when browser storage is blocked.
    }
    for (const listener of listeners) listener();
  }
  return [state, update] as const;
}
