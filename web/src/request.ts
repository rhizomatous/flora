export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const fallback = `Request failed (HTTP ${response.status}). Check the server or reverse proxy and try again.`;
  // Proxy error pages may contain internal details. Never display their body.
  if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new Error(fallback);
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(fallback); }
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : fallback);
  return result as T;
}
