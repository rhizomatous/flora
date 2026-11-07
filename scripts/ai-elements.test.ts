import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import upstream from "../florets/src/ai/upstream.json" with { type: "json" };

void test("vendored AI Elements retain their recorded upstream import", async () => {
  assert.equal(upstream.patterns.length, 21);
  for (const [path, file] of Object.entries(upstream.files)) {
    const content = await readFile(path);
    assert.equal(createHash("sha256").update(content).digest("hex"), file.importedSha256, path);
  }
  for (const pattern of upstream.patterns) {
    assert.ok(`florets/docs/src/ai/examples/${pattern}-demo.tsx` in upstream.files, pattern);
  }
});
