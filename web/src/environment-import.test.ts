import { describe, expect, it } from "vitest";

import { parseEnvironmentFile } from "./environment-import";

describe("dotenv import", () => {
  it("reads comments, exports, blank values, quotes and multiline values as secrets", () => {
    const values = parseEnvironmentFile(
      '\uFEFF# comment\r\nexport API_KEY = "fixture\\nkey" # note\r\nEMPTY=\r\nSINGLE=\'literal $TOKEN\'\r\nMULTI="line one\nline two"\nURL=https://example.test/#fragment\nPLAIN=value # comment',
    );
    expect(values.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "API_KEY", value: "fixture\nkey" },
      { name: "EMPTY", value: "" },
      { name: "SINGLE", value: "literal $TOKEN" },
      { name: "MULTI", value: "line one\nline two" },
      { name: "URL", value: "https://example.test/#fragment" },
      { name: "PLAIN", value: "value" },
    ]);
    expect(values.every((v) => v.secret && v.action === "replace")).toBe(true);
  });
  it("preserves shell expressions without executing or expanding them", () => {
    expect(
      parseEnvironmentFile(`COMMAND=$(touch /tmp/never-run)\nREFERENCE=\${TOKEN}`)[0]?.value,
    ).toBe("$(touch /tmp/never-run)");
    expect(parseEnvironmentFile(`REFERENCE=\${TOKEN}`)[0]?.value).toBe(`\${TOKEN}`);
  });
  it.each([
    "TOKEN=fixture-secret\nTOKEN=other-secret",
    "not an assignment",
    'TOKEN="fixture-secret',
    'TOKEN="fixture-secret" unexpected',
  ])("rejects malformed imports without echoing values: %s", (input) => {
    expect(() => parseEnvironmentFile(input)).toThrow();
    try {
      parseEnvironmentFile(input);
    } catch (e) {
      expect(String(e)).not.toContain("fixture-secret");
    }
  });
  it("rejects empty, oversized and excessive imports", () => {
    expect(() => parseEnvironmentFile("# nothing")).toThrow("at least one");
    expect(() => parseEnvironmentFile(`A=${"x".repeat(65_536)}`)).toThrow("64 KiB");
    expect(() =>
      parseEnvironmentFile(Array.from({ length: 101 }, (_, i) => `KEY_${i}=value`).join("\n")),
    ).toThrow("100");
  });
});
