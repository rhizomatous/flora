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

const diagnostic = (result: unknown) =>
  typeof result === "object" &&
  result !== null &&
  "error" in result &&
  typeof result.error === "string"
    ? result.error
    : undefined;

/**
 * Sends a same-origin JSON request to the Flora API and returns the parsed body. The caller
 * chooses `T`; the body is not validated. Failures throw a RequestError carrying the server's
 * JSON diagnostic when there is one.
 */
export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
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
  if (!response.ok) throw new RequestError(diagnostic(result) ?? fallback, response.status);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Callers own the response shape.
  return result as T;
}
