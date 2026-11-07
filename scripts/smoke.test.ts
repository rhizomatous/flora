import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const binary = fileURLToPath(new URL("../bin/flora", import.meta.url));
const image = `fixture/agent@sha256:${"a".repeat(64)}`;

function run(
  args: string[],
  executable = binary,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: tmpdir(), timeout: 5000 });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (data: string) => {
      stdout += data;
    });
    child.stderr.setEncoding("utf8").on("data", (data: string) => {
      stderr += data;
    });
    child.once("error", reject);
    // Process exit can precede the last stdout/stderr data events.
    child.once("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

test("captured output includes data arriving after process exit", async () => {
  // The child outlives its parent while retaining the parent's output pipes.
  const writer =
    'setTimeout(() => { process.stdout.write("last stdout"); process.stderr.write("last stderr"); }, 100);';
  const parent = `const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", ${JSON.stringify(writer)}], { stdio: ["ignore", 1, 2] }).unref();
    process.exit(0);`;
  const result = await run(["-e", parent], process.execPath);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "last stdout");
  assert.equal(result.stderr, "last stderr");
});

test("version and help work without initializing storage or Docker", async () => {
  const version = await run(["-version"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /"harness_version":"1\.2\.27"/);
  const help = await run(["-help"]);
  assert.equal(help.status, 0);
  assert.match(help.stderr, /-public-url/);
  assert.doesNotMatch(help.stderr, /-hostname|-github-listen|-public-listen|-agent-network-id/);
});

test("standalone binary requires a public HTTPS origin", async () => {
  for (const origin of [
    "",
    "http://localhost:8080",
    "http://flora.test",
    "https://flora.test/path",
    "https://user:DO_NOT_PRINT@flora.test",
  ]) {
    const result = await run(["-public-url", origin]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set -public-url/);
    assert.doesNotMatch(result.stderr, /Flora listening|DO_NOT_PRINT/);
  }
});

test("standalone binary rejects non-loopback browser listeners before initialization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flora-listen-failure-"));
  try {
    for (const address of [
      ":8080",
      "0.0.0.0:8080",
      "[::]:8080",
      "192.168.1.2:8080",
      "localhost:8080",
    ]) {
      const result = await run([
        "-listen",
        address,
        "-public-url",
        "https://flora.test",
        "-data-dir",
        join(dir, "data"),
      ]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Invalid -listen/);
      assert.deepEqual(await readdir(dir), []);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("standalone binary rejects unusable storage before listening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flora-storage-failure-"));
  try {
    const file = join(dir, "file");
    await writeFile(file, "not a directory");
    const result = await run([
      "-data-dir",
      join(file, "storage"),
      "-public-url",
      "https://flora.test",
      "-agent-image",
      image,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Storage initialization failed/);
    assert.deepEqual(await readdir(dir), ["file"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("standalone binary rejects nonpositive capacity before opening storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flora-capacity-failure-"));
  try {
    for (const limit of ["0", "-1"]) {
      const result = await run([
        "-max-running",
        limit,
        "-public-url",
        "https://flora.test",
        "-data-dir",
        join(dir, "data"),
      ]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Set -max-running to a positive number/);
      assert.deepEqual(await readdir(dir), []);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
