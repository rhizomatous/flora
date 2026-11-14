import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";
import { test } from "vitest";

import { exampleAnchor, sourceForExample, standaloneSource } from "./example-source-utils.ts";

test("focused snippets keep transitive helpers and module-level data", () => {
  const source = `import { Button } from "@flora/florets";
import { Example, ExampleWrapper } from "../example";
const label = "Save";
function Other() {
  return <Example title="Other">Other</Example>;
}
function Helper() {
  return <Button>{label}</Button>;
}
function Selected() {
  return <Example title="Selected"><Helper /></Example>;
}`;
  const result = sourceForExample(source, "Selected");
  assert.match(result, /export function Selected/);
  assert.match(result, /function Helper/);
  assert.match(result, /const label = "Save"/);
  assert.doesNotMatch(result, /function Other|\.\.\/example|<Example/);
  assert.match(result, /<div><Helper \/><\/div>/);
});

test("all example variants produce source without documentation-only imports", async () => {
  const directory = new URL("examples/upstream/", import.meta.url);
  let checked = 0;
  const snippets: Record<string, string> = {};
  for (const file of await readdir(directory)) {
    const source = await readFile(new URL(file, directory), "utf8");
    for (const match of source.matchAll(/<Example\s[^>]*title="([^"]+)"/g)) {
      const result = sourceForExample(source, match[1]);
      assert.doesNotMatch(result, /from "\.\.\//, `${file}: ${match[1]}`);
      assert.doesNotMatch(result, /<\/?Example(?:Wrapper)?\b/, `${file}: ${match[1]}`);
      assert.match(result, /export function /);
      snippets[`/snippet-tests/${checked}.tsx`] = result;
      checked++;
    }
  }
  assert.ok(checked > 400);
  const aiDirectory = new URL("ai/examples/", import.meta.url);
  const animations = await readFile(
    new URL("ai/lib/message-animations.ts", import.meta.url),
    "utf8",
  );
  for (const file of await readdir(aiDirectory)) {
    const source = await readFile(new URL(file, aiDirectory), "utf8");
    const result = standaloneSource(source, animations);
    assert.doesNotMatch(result, /from "\.\.\//, file);
    snippets[`/snippet-tests/${file}`] = result;
  }
  const config = "/snippet-tests/tsconfig.json";
  const files = Object.keys(snippets);
  const api = new API({
    cwd: "/snippet-tests",
    fs: createVirtualFileSystem({
      ...snippets,
      [config]: JSON.stringify({
        compilerOptions: { jsx: "react-jsx", noResolve: true },
        files,
      }),
    }),
  });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    try {
      const project = snapshot.getProjects()[0];
      assert.ok(project);
      const diagnostics = project.program.getSyntacticDiagnostics();
      assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics.slice(0, 3)));
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
});

test("unknown examples preserve their source and headings normalize punctuation", () => {
  assert.equal(sourceForExample("unrecognized source", "Missing"), "unrecognized source");
  assert.equal(exampleAnchor("Variants & Sizes"), "example-variants-sizes");
});
