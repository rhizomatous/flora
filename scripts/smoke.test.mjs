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
    assert.equal(await (await fetch(`${base}/chats/example`)).text(), html);
    assert.equal((await fetch(`${base}/api/missing`)).status, 404);
    assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
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
