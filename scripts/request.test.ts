import assert from "node:assert/strict";
import { test } from "node:test";

import { request, RequestError } from "../web/src/request.ts";

test("API requests preserve method, credentials, and JSON body", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/auth/login");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { password: "test-password" });
    return Response.json({ authenticated: true });
  });
  assert.deepEqual(await request("auth/login", "POST", { password: "test-password" }), {
    authenticated: true,
  });
});

test("API failures keep safe JSON diagnostics", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Password is incorrect." }, { status: 401 }),
  );
  await assert.rejects(request("auth/login"), {
    name: "RequestError",
    message: "Password is incorrect.",
    status: 401,
  });
});

test("validation failures expose their HTTP status as an Error", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Base branch was not found." }, { status: 400 }),
  );
  await assert.rejects(request("projects", "POST", {}), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error instanceof RequestError);
    assert.equal(error.status, 400);
    assert.equal(error.message, "Base branch was not found.");
    return true;
  });
});

for (const [name, body, contentType, status] of [
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
]) {
  test(`${name} returns a useful status error without the response body`, async (t) => {
    t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(body, { status, headers: { "Content-Type": contentType } }),
    );
    await assert.rejects(request("settings"), {
      name: "RequestError",
      message: `Request failed (HTTP ${status}). Check the server or reverse proxy and try again.`,
      status,
    });
  });
}
