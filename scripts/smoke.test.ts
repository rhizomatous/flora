import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const binary = fileURLToPath(new URL("../bin/flora", import.meta.url));

/**
 * Starts the Flora binary and collects its stderr. It runs from the temporary directory so no
 * source files or dist directory are available in the working directory.
 */
function startFlora(args: string[]) {
  const child = spawn(binary, args, { cwd: tmpdir(), stdio: ["ignore", "ignore", "pipe"] });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  let output = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    output += chunk;
  });
  return { child, exited, output: () => output };
}

async function isHealthy(base: string) {
  try {
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
    assert.deepEqual(await health.json(), { status: "ok" });
    return true;
  } catch {
    return false;
  }
}

async function status(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  return response.status;
}

async function json(url: string) {
  const response = await fetch(url);
  return (await response.json()) as unknown;
}

function contentType(response: Response) {
  const type = response.headers.get("content-type");
  assert.ok(type !== null, `${response.url} has no content type`);
  return type;
}

test(
  "standalone binary serves embedded web assets and shuts down cleanly",
  { timeout: 15_000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "flora-smoke-"));
    const { child, exited, output } = startFlora([
      "-listen",
      "127.0.0.1:0",
      "-data-dir",
      dataDir,
      "-public-url",
      "https://FLORA.test:443/",
      "-max-running",
      "3",
    ]);
    try {
      let base = "";
      for (let attempt = 0; attempt < 100 && base === ""; attempt++) {
        assert.equal(child.exitCode, null, output());
        const address = /address=(127\.0\.0\.1:\d+)/.exec(output())?.[1];
        if (address !== undefined && (await isHealthy(`http://${address}`))) {
          base = `http://${address}`;
        } else {
          await delay(50);
        }
      }
      assert.notEqual(base, "", `server did not start: ${output()}`);
      const database = await stat(join(dataDir, "flora.db"));
      assert.equal(database.mode & 0o777, 0o600);
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
        assert.doesNotMatch(contentType(asset), /text\/html/);
        const text = await asset.text();
        assert.ok(text.length > 0);
      }
      for (const path of ["/chats/example", "/chats/john.doe", "/chats/archive.css/messages"]) {
        const route = await fetch(`${base}${path}`);
        assert.equal(route.status, 200, path);
        assert.equal(await route.text(), html, path);
      }
      assert.deepEqual(await json(`${base}/api/auth/status`), {
        setupRequired: true,
        enrollmentRequired: false,
        authenticated: false,
      });
      for (const path of [
        "/api",
        "/api/projects",
        "/api/chats/one/logs",
        "/api/chats/one/diff",
        "/api/chats/one/download",
        "/api/chats/one/events",
        "/api/settings",
      ]) {
        assert.equal(await status(`${base}${path}`), 401, path);
      }
      const headers = { "Content-Type": "application/json", Origin: "https://flora.test" };
      const body = JSON.stringify({ password: "smoke-test-password" });
      assert.equal(
        await status(`${base}/api/auth/bootstrap`, {
          method: "POST",
          headers: { ...headers, Origin: "https://attacker.test" },
          body,
        }),
        403,
      );
      const setup = await fetch(`${base}/api/auth/bootstrap`, { method: "POST", headers, body });
      assert.equal(setup.status, 200);
      const cookieHeader = setup.headers.get("set-cookie");
      assert.ok(cookieHeader !== null, "bootstrap must set a session cookie");
      assert.match(cookieHeader, /Secure/);
      assert.match(cookieHeader, /HttpOnly/);
      assert.match(cookieHeader, /SameSite=Strict/);
      const cookie = cookieHeader.split(";")[0] ?? "";
      assert.equal(await status(`${base}/api/settings`, { headers: { Cookie: cookie } }), 200);
      assert.equal(
        await status(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { ...headers, Cookie: cookie },
        }),
        200,
      );
      assert.equal(await status(`${base}/api/settings`, { headers: { Cookie: cookie } }), 401);
      for (const path of [
        "/assets",
        "/assets/",
        "/assets/missing",
        "/assets/missing.js",
        "/missing.css",
        "/favicon.ico",
      ]) {
        const missing = await fetch(`${base}${path}`, { redirect: "manual" });
        assert.equal(missing.status, 404, path);
        assert.doesNotMatch(contentType(missing), /text\/html/, path);
      }
      child.kill("SIGTERM");
      const { code, signal } = await exited;
      assert.equal(code, 0, output());
      assert.equal(signal, null);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);

test(
  "standalone binary rejects unusable storage before listening",
  { timeout: 15_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "flora-storage-failure-"));
    try {
      const file = join(dir, "file");
      await writeFile(file, "not a directory");
      const { exited, output } = startFlora([
        "-listen",
        "127.0.0.1:0",
        "-data-dir",
        join(file, "storage"),
        "-public-url",
        "https://flora.test",
      ]);
      const { code, signal } = await exited;
      assert.equal(code, 1);
      assert.equal(signal, null);
      assert.match(output(), /Storage initialization failed/);
      assert.doesNotMatch(output(), /Flora listening/);
      assert.deepEqual(await readdir(dir), ["file"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("standalone binary requires a public HTTPS origin", { timeout: 15_000 }, async () => {
  for (const origin of [
    "",
    "http://flora.test",
    "https://flora.test/path",
    "https://user:DO_NOT_PRINT@flora.test",
  ]) {
    const { exited, output } = startFlora(["-public-url", origin]);
    const { code } = await exited;
    assert.equal(code, 1);
    assert.match(output(), /Set -public-url/);
    assert.doesNotMatch(output(), /Flora listening|DO_NOT_PRINT/);
  }
});

test(
  "standalone binary rejects nonpositive container capacity before opening storage",
  { timeout: 15_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "flora-capacity-failure-"));
    try {
      for (const limit of ["0", "-1"]) {
        const { exited, output } = startFlora([
          "-max-running",
          limit,
          "-public-url",
          "https://flora.test",
          "-data-dir",
          join(dir, "data"),
        ]);
        const { code } = await exited;
        assert.equal(code, 1);
        assert.match(output(), /Set -max-running to a positive number/);
        assert.doesNotMatch(output(), /Flora listening/);
        assert.deepEqual(await readdir(dir), []);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
