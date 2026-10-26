import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("standalone binary serves embedded web assets and shuts down cleanly", { timeout: 15000 }, async () => {
  const binary = fileURLToPath(new URL("../bin/flora", import.meta.url));
  const child = spawn(binary, ["-listen", "127.0.0.1:0"], {
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
    for (const path of ["/api", "/api/missing", "/api/john.doe", "/assets", "/assets/", "/assets/missing", "/assets/missing.js", "/missing.css", "/favicon.ico"]) {
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
  }
});
