import { useEffect, useState } from "react";
import { z } from "zod";

import { errorMessage, request } from "./request";

export const environmentSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  secret: z.boolean(),
  description: z.string().optional(),
});
export type EnvironmentVariable = z.infer<typeof environmentSchema>;

export function useEnvironment(path: string) {
  const [values, setValues] = useState<EnvironmentVariable[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError("");
      try {
        const next = await request(environmentSchema.array(), path, { signal: controller.signal });
        if (!controller.signal.aborted) setValues(next);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(errorMessage(e, "Could not load environment variables."));
        }
      }
    }
    void load();
    return () => {
      controller.abort();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refresh explicitly reloads metadata after a project save or failed request.
  }, [path, revision]);
  return {
    values,
    setValues,
    error,
    refresh: () => {
      setRevision((v) => v + 1);
    },
  };
}
