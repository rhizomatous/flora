import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { chatSchema } from "./chat-schemas";
import { request, errorMessage } from "./request";

const runtimeSchema = z.object({
  state: z.enum(["stopped", "starting", "running", "failed", "missing", "unknown"]),
  observedAt: z.string(),
  cpuLimit: z.number().nullable(),
  memoryLimit: z.number().nullable(),
  usage: z
    .object({
      sampledAt: z.string(),
      cpuSeconds: z.number(),
      memoryBytes: z.number(),
      diskBytes: z.number().nullable(),
    })
    .nullable(),
  collectionError: z.string(),
  keepAwakeUntil: z.string().nullable(),
});
export type Runtime = z.infer<typeof runtimeSchema>;
export function useRuntime(id: string, open: boolean) {
  const [runtime, setRuntime] = useState<Runtime>();
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const actionRevision = useRef(0);
  const [pending, setPending] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const path = `chats/${encodeURIComponent(id)}`;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const value = await request(runtimeSchema, `${path}/runtime`, signal ? { signal } : {});
        setRuntime(value);
        setRefreshError("");
        setNow(Date.now());
      } catch (e) {
        if (signal?.aborted !== true) {
          setRuntime(undefined);
          setRefreshError(errorMessage(e, "Could not refresh machine state."));
        }
      }
    },
    [path],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const initial = setTimeout(() => {
      void refresh(controller.signal);
    }, 0);
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh(controller.signal);
    }, 5000);
    return () => {
      clearTimeout(initial);
      controller.abort();
      clearInterval(timer);
    };
  }, [open, refresh]);
  async function act(action: "wake" | "keep-awake" | "stop", seconds?: number) {
    const revision = ++actionRevision.current;
    setError("");
    setPending(action);
    try {
      await (action === "keep-awake"
        ? request(z.object({ ok: z.boolean() }), `${path}/${action}`, {
            method: "POST",
            body: { seconds },
          })
        : request(chatSchema, `${path}/${action}`, { method: "POST", body: {} }));
    } catch (e) {
      if (revision === actionRevision.current) {
        const message = errorMessage(e, "Machine action failed.");
        setError(message);
        toast.error(message, { toasterId: "chat-organization" });
      }
    } finally {
      if (revision === actionRevision.current) {
        setPending("");
        await refresh();
      }
    }
  }
  return { runtime, pending, error: error || refreshError, now, act, refresh };
}
