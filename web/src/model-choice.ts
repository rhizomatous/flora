import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { chatSchema, detailSchema } from "./chat-schemas";
import { executionSchema, type Execution } from "./execution-schema";
import { request } from "./request";

const choiceEvent = "flora:model-choice";
const changeSchema = z.object({ scope: z.string(), value: executionSchema, revision: z.number() });
type Choice = z.infer<typeof changeSchema>;
const savedChoices = new Map<string, Choice>();

function readNewChatChoice(scope: string) {
  try {
    const draft = executionSchema.safeParse(
      JSON.parse(sessionStorage.getItem(`flora-model:${scope}`) ?? "null"),
    );
    if (draft.success) return { scope, value: draft.data, revision: 0 };
  } catch {
    // New chats can still be configured when browser storage is unavailable.
  }
  return null;
}

export function resolveModelChoice(
  current: Execution | null | undefined,
  fallback: Execution | undefined,
) {
  return current?.model !== undefined && current.model !== "" ? current : fallback;
}

function publishChoice(choice: Choice) {
  if ((savedChoices.get(choice.scope)?.revision ?? -1) > choice.revision) return;
  savedChoices.set(choice.scope, choice);
  window.dispatchEvent(new CustomEvent(choiceEvent, { detail: choice }));
}

/** Existing chats have one server-saved choice. New chats retain their selection until creation. */
export function useModelChoice(scope: string, saved?: Execution, revision = 0) {
  const existing = scope.startsWith("chat:");
  const [choice, setChoice] = useState<Choice | null>(
    () => savedChoices.get(scope) ?? (existing ? null : readNewChatChoice(scope)),
  );
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const selected =
    existing && (choice?.revision ?? 0) <= revision ? (saved ?? null) : (choice?.value ?? null);
  const currentRevision = Math.max(revision, choice?.revision ?? 0);
  useEffect(() => {
    const update = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = changeSchema.safeParse(event.detail);
      if (parsed.success && parsed.data.scope === scope) {
        setChoice((current) =>
          current === null || parsed.data.revision >= current.revision ? parsed.data : current,
        );
      }
    };
    window.addEventListener(choiceEvent, update);
    return () => {
      window.removeEventListener(choiceEvent, update);
    };
  }, [scope]);
  useEffect(() => {
    if (
      existing &&
      saved &&
      saved.model !== "" &&
      revision > (savedChoices.get(scope)?.revision ?? -1)
    ) {
      publishChoice({ scope, value: saved, revision });
    }
  }, [existing, revision, saved, scope]);
  async function choose(value: Execution) {
    if (!existing) {
      const next = { scope, value, revision: 0 };
      setChoice(next);
      publishChoice(next);
      try {
        sessionStorage.setItem(`flora-model:${scope}`, JSON.stringify(value));
      } catch {
        /* The selection remains available until the page closes. */
      }
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    const path = `chats/${encodeURIComponent(scope.slice(5))}`;
    try {
      const chat = await request(chatSchema, `${path}/model`, {
        method: "PATCH",
        body: { execution: value, revision: currentRevision },
      });
      if (chat.Execution) {
        publishChoice({ scope, value: chat.Execution, revision: chat.ExecutionRevision ?? 0 });
      }
    } catch (cause) {
      // A timed-out save may have committed. Reconcile with the server before reporting failure.
      try {
        const detail = await request(detailSchema, path);
        if (detail.chat.Execution) {
          publishChoice({
            scope,
            value: detail.chat.Execution,
            revision: detail.chat.ExecutionRevision ?? 0,
          });
          const confirmed = detail.chat.Execution;
          if (
            confirmed.provider === value.provider &&
            confirmed.model === value.model &&
            confirmed.variant === value.variant
          ) {
            return;
          }
        }
      } catch {
        /* Retain the last confirmed choice when the server cannot be reached. */
      }
      throw cause;
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return { selected, pending, choose };
}
