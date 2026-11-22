import { useEffect, useState } from "react";
import { z } from "zod";

import { executionSchema, type Execution } from "./execution-schema";

const choiceEvent = "flora:model-choice";
const memoryChoices = new Map<string, Execution>();
const changeSchema = z.object({ scope: z.string(), value: executionSchema });

function readChoice(scope: string) {
  const remembered = memoryChoices.get(scope);
  if (remembered) return remembered;
  try {
    const draft = executionSchema.safeParse(
      JSON.parse(sessionStorage.getItem(`flora-model:${scope}`) ?? "null"),
    );
    if (draft.success) return draft.data;
  } catch {
    // Choices remain usable when browser storage is unavailable.
  }
  return null;
}

export function resolveModelChoice(
  draft: Execution | null,
  saved: Execution | undefined,
  fallback: Execution | undefined,
) {
  return draft ?? (saved?.model !== undefined && saved.model !== "" ? saved : fallback);
}

/** Composer and summaries share browser drafts; accepted choices come from the saved chat. */
export function useModelChoice(scope: string) {
  const [selected, setSelected] = useState<Execution | null>(() => readChoice(scope));
  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof CustomEvent) {
        const parsed = changeSchema.safeParse(event.detail);
        if (parsed.success && parsed.data.scope === scope) setSelected(parsed.data.value);
      }
    };
    window.addEventListener(choiceEvent, update);
    return () => {
      window.removeEventListener(choiceEvent, update);
    };
  }, [scope]);
  function choose(value: Execution) {
    setSelected(value);
    memoryChoices.set(scope, value);
    try {
      sessionStorage.setItem(`flora-model:${scope}`, JSON.stringify(value));
    } catch {
      // The event also updates summaries when the draft cannot be stored.
    }
    window.dispatchEvent(new CustomEvent(choiceEvent, { detail: { scope, value } }));
  }
  return { selected, choose };
}
