import { z } from "zod";

export class RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

/** Reports whether a request failed because the browser session ended. */
export const isExpired = (error: unknown) => error instanceof RequestError && error.status === 401;

/** Returns the message of a thrown Error, or the fallback for anything else. */
export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const diagnosticSchema = z.object({ error: z.string() });

/** Parses a same-origin API response before returning it to the caller. HTTP and malformed
 * response failures carry the status, without exposing raw response data in the diagnostic. */
export async function request<T>(
  schema: z.ZodType<T>,
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`/api/${path}`, init);
  const fallback = `Request failed (HTTP ${response.status}). Check the server or reverse proxy and try again.`;
  // Proxy error pages may contain internal details. Never display their body.
  const type = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new RequestError(fallback, response.status);
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new RequestError(fallback, response.status);
  }
  if (!response.ok) {
    const diagnostic = diagnosticSchema.safeParse(result);
    throw new RequestError(diagnostic.success ? diagnostic.data.error : fallback, response.status);
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw new RequestError(
      "Could not read the server response. Reload and try again.",
      response.status,
    );
  }
  return parsed.data;
}
