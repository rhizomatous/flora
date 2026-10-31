import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("standalone binary serves embedded web assets and shuts down cleanly", { timeout: 15000 }, async () => {
  const binary = fileURLToPath(new URL("../bin/flora", import.meta.url));
  const dataDir = await mkdtemp(join(tmpdir(), "flora-smoke-"));
  const child = spawn(binary, ["-listen", "127.0.0.1:0", "-data-dir", dataDir, "-public-url", "https://FLORA.test:443/", "-max-running", "3"], {
    // No source files or dist directory are available in the working directory.
    cwd: tmpdir(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "";
  child.stderr.on("data", (chunk) => { output += chunk; });
  let base;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, output);
      try {
        const address = output.match(/address=(127\.0\.0\.1:\d+)/)?.[1];
        assert.ok(address, "waiting for listening address");
        base = `http://${address}`;
        const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
        assert.deepEqual(await health.json(), { status: "ok" });
        ready = true;
        break;
      } catch {
        await delay(50);
      }
    }
    assert.ok(ready, `server did not start: ${output}`);
    assert.equal((await stat(join(dataDir, "flora.db"))).mode & 0o777, 0o600);
    for (const name of ["workspaces", "runtime-state", "logs", "artifacts"]) {
      const info = await stat(join(dataDir, name));
      assert.ok(info.isDirectory(), name);
      assert.equal(info.mode & 0o777, 0o700, name);
    }
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>Flora<\/title>/);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)];
    assert.ok(assets.length >= 2, "HTML must reference built JavaScript and CSS");
    for (const [, path] of assets) {
      const asset = await fetch(`${base}${path}`);
      assert.equal(asset.status, 200);
      assert.doesNotMatch(asset.headers.get("content-type"), /text\/html/);
      assert.ok((await asset.text()).length > 0);
    }
    for (const path of ["/chats/example", "/chats/john.doe", "/chats/archive.css/messages"]) {
      const route = await fetch(`${base}${path}`);
      assert.equal(route.status, 200, path);
      assert.equal(await route.text(), html, path);
    }
    assert.deepEqual(await (await fetch(`${base}/api/auth/status`)).json(), { setupRequired: true, authenticated: false });
    for (const path of ["/api", "/api/projects", "/api/chats/one/logs", "/api/chats/one/diff", "/api/chats/one/download", "/api/chats/one/events", "/api/settings"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 401, path);
    }
    const headers = { "Content-Type": "application/json", Origin: "https://flora.test" };
    const body = JSON.stringify({ password: "smoke-test-password" });
    assert.equal((await fetch(`${base}/api/auth/bootstrap`, { method: "POST", headers: { ...headers, Origin: "https://attacker.test" }, body })).status, 403);
    const setup = await fetch(`${base}/api/auth/bootstrap`, { method: "POST", headers, body });
    assert.equal(setup.status, 200);
    const cookieHeader = setup.headers.get("set-cookie");
    assert.match(cookieHeader, /Secure/);
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/);
    const cookie = cookieHeader.split(";")[0];
    assert.equal((await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...headers, Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } })).status, 401);
    for (const path of ["/assets", "/assets/", "/assets/missing", "/assets/missing.js", "/missing.css", "/favicon.ico"]) {
      const missing = await fetch(`${base}${path}`, { redirect: "manual" });
      assert.equal(missing.status, 404, path);
      assert.doesNotMatch(missing.headers.get("content-type"), /text\/html/, path);
    }
    child.kill("SIGTERM");
    const [code, signal] = await exited;
    assert.equal(code, 0, output);
    assert.equal(signal, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("standalone binary rejects unusable storage before listening", { timeout: 15000 }, async () => {
  const binary = fileURLToPath(new URL("../bin/flora", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "flora-storage-failure-"));
  try {
    const file = join(dir, "file");
    await writeFile(file, "not a directory");
    const child = spawn(binary, ["-listen", "127.0.0.1:0", "-data-dir", join(file, "storage"), "-public-url", "https://flora.test"], {
      cwd: tmpdir(), stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    child.stderr.on("data", chunk => { output += chunk; });
    const [code, signal] = await once(child, "exit");
    assert.equal(code, 1);
    assert.equal(signal, null);
    assert.match(output, /Storage initialization failed/);
    assert.doesNotMatch(output, /Flora listening/);
    assert.deepEqual(await readdir(dir), ["file"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("standalone binary requires a public HTTPS origin", { timeout: 15000 }, async () => {
  const binary = fileURLToPath(new URL("../bin/flora", import.meta.url));
  for (const origin of ["", "http://flora.test", "https://flora.test/path", "https://user:DO_NOT_PRINT@flora.test"]) {
    const child = spawn(binary, ["-public-url", origin], { cwd: tmpdir(), stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    child.stderr.on("data", chunk => { output += chunk; });
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(output, /Set -public-url/);
    assert.doesNotMatch(output, /Flora listening|DO_NOT_PRINT/);
  }
});

test("standalone binary rejects nonpositive container capacity before opening storage", { timeout: 15000 }, async () => {
  const binary = fileURLToPath(new URL("../bin/flora", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "flora-capacity-failure-"));
  try {
    for (const limit of ["0", "-1"]) {
      const child = spawn(binary, ["-max-running", limit, "-public-url", "https://flora.test", "-data-dir", join(dir, "data")], {
        cwd: tmpdir(), stdio: ["ignore", "ignore", "pipe"],
      });
      let output = "";
      child.stderr.on("data", chunk => { output += chunk; });
      const [code] = await once(child, "exit");
      assert.equal(code, 1);
      assert.match(output, /Set -max-running to a positive number/);
      assert.doesNotMatch(output, /Flora listening/);
      assert.deepEqual(await readdir(dir), []);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
