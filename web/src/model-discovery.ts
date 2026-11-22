import { useEffect, useState } from "react";
import { z } from "zod";

import { executionSchema } from "./execution-schema";
import { modelOptionSchema } from "./model-options";
import { errorMessage, request } from "./request";

const modelsSchema = z.object({
  default: executionSchema,
  models: z.array(modelOptionSchema),
  error: z.string(),
});

/** Resolve display names and the installation default through the same discovery API. */
export function useModelDiscovery(scope: string) {
  const [options, setOptions] = useState<z.infer<typeof modelsSchema>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const path = scope.startsWith("chat:")
    ? `models?chat=${encodeURIComponent(scope.slice(5))}`
    : "models";
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await request(modelsSchema, path, { signal: controller.signal });
        setOptions(result);
        setError(result.error);
      } catch (cause) {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Could not load models."));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- An explicit retry repeats discovery even when the path is unchanged.
  }, [attempt, path]);
  function retry() {
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  return { options, loading, error, retry };
}
