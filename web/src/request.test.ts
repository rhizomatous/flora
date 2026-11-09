import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { request, RequestError } from "./request.ts";

test("API requests preserve method, credentials, and JSON body", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, "/api/auth/login");
    assert.equal(init?.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.equal(new Headers(init.headers).get("Content-Type"), "application/json");
    assert.ok(typeof init.body === "string");
    assert.deepEqual(JSON.parse(init.body), { password: "test-password" });
    return Promise.resolve(Response.json({ authenticated: true }));
  });
  assert.deepEqual(await request("auth/login", "POST", { password: "test-password" }), {
    authenticated: true,
  });
});

test("API failures keep safe JSON diagnostics", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ error: "Password is incorrect." }, { status: 401 })),
  );
  await assert.rejects(request("auth/login"), {
    name: "RequestError",
    message: "Password is incorrect.",
    status: 401,
  });
});

test("validation failures expose their HTTP status as an Error", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ error: "Base branch was not found." }, { status: 400 })),
  );
  await assert.rejects(request("projects", "POST", {}), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error instanceof RequestError);
    assert.equal(error.status, 400);
    assert.equal(error.message, "Base branch was not found.");
    return true;
  });
});

const unsafeResponses = [
  ["HTML proxy error", "<html>INTERNAL_PRIVATE_DETAILS</html>", "text/html", 502],
  ["plain proxy error", "INTERNAL_PRIVATE_DETAILS", "text/plain", 503],
  ["malformed JSON", "INTERNAL_PRIVATE_DETAILS", "application/json", 502],
  ["unexpected successful HTML", "<html>INTERNAL_PRIVATE_DETAILS</html>", "text/html", 200],
  [
    "JSON without diagnostic",
    '{"error":{"details":"INTERNAL_PRIVATE_DETAILS"}}',
    "application/json",
    500,
  ],
  ["null JSON error", "null", "application/json", 500],
] as const;

for (const [name, body, contentType, status] of unsafeResponses) {
  test(`${name} returns a useful status error without the response body`, async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(body, { status, headers: { "Content-Type": contentType } })),
    );
    await assert.rejects(request("settings"), {
      name: "RequestError",
      message: `Request failed (HTTP ${status}). Check the server or reverse proxy and try again.`,
      status,
    });
  });
}
