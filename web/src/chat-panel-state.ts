import { useSyncExternalStore } from "react";
import { z } from "zod";

const shellTabSchema = z.object({ id: z.string(), title: z.string() });
const workspaceTabSchema = z.object({ repository: z.string(), path: z.string() });
const schema = z.object({
  open: z.boolean().default(false),
  mainView: z.string().default("chat"),
  mainDiffOpen: z.boolean().default(false),
  mainSubagentTabs: z.array(z.string()).default([]),
  diffOpen: z.boolean().default(false),
  filesOpen: z.boolean().default(false),
  shellTabs: z.array(shellTabSchema).default([]),
  workspaceTabs: z.array(workspaceTabSchema).default([]),
  workspaceExpanded: z.array(z.string()).default([]),
  view: z.string().default("overview"),
  subagentTabs: z.array(z.string()).default([]),
  width: z.number().min(1).max(99).default(40),
  pullTabs: z.array(z.string()).default([]),
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
  states.set(id, state);
  return state;
}

export function workspaceFileView(file: { repository: string; path: string }) {
  return `file:${JSON.stringify([file.repository, file.path])}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatPanelState(id: string) {
  const state = useSyncExternalStore(subscribe, () => read(id));
  function update(
    patch: Partial<ChatPanelState> | ((current: ChatPanelState) => Partial<ChatPanelState>),
  ) {
    const current = read(id);
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
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
