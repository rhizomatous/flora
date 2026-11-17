import { generateManifest } from "material-icon-theme";
import { expect, test } from "vitest";

import { fileIcon, type FileIconManifest } from "./file-icon";

const source = generateManifest();
const manifest: FileIconManifest = {
  names: source.fileNames ?? {},
  extensions: source.fileExtensions ?? {},
  lightNames: source.light?.fileNames ?? {},
  lightExtensions: source.light?.fileExtensions ?? {},
  fallback: source.file ?? "file",
};

test.each([
  ["lib/server.ex", "elixir"],
  ["src/main.clj", "clojure"],
  ["Main.hs", "haskell"],
  ["main.zig", "zig"],
  ["analysis.jl", "julia"],
  ["App.vue", "vue"],
  ["types/index.d.ts", "typescript-def"],
  ["src/feed.test.ts", "test-ts"],
  [String.raw`C:\project\Dockerfile`, "docker"],
  ["src/APP.TSX", "react_ts"],
  ["private.custom-format", "file"],
  ["unknown", "file"],
  ["constructor", "file"],
  ["__proto__", "file"],
])("resolves %s using the catalog", (path, expected) => {
  expect(fileIcon(path, manifest)).toBe(expected);
});

test("uses light variants and falls back to the normal mapping", () => {
  expect(fileIcon("vercel.json", manifest, true)).toBe("vercel_light");
  expect(fileIcon("vercel.json", manifest)).toBe("vercel");
  expect(fileIcon("App.tsx", manifest, true)).toBe("react_ts");
});

test("honors parent directory filename associations", () => {
  const mapping = {
    ...manifest,
    names: { "config/settings.json": "settings", "settings.json": "json" },
  };
  expect(fileIcon("project/config/settings.json", mapping)).toBe("settings");
});
