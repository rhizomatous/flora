export class RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const fallback = `Request failed (HTTP ${response.status}). Check the server or reverse proxy and try again.`;
  // Proxy error pages may contain internal details. Never display their body.
  if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError(fallback, response.status);
  }
  let result;
  try { result = await response.json(); }
  catch { throw new RequestError(fallback, response.status); }
  if (!response.ok) throw new RequestError(typeof result?.error === "string" ? result.error : fallback, response.status);
  return result as T;
}
