import { expect, it } from "vitest";

import type { FileChange } from "./changes-schemas";
import { diffTree } from "./diff-tree";

const file = (path: string, repository = "app"): FileChange => ({
  path,
  repository,
  status: "M",
  diff: "",
  bytes: 0,
  truncated: false,
  binary: false,
  undisplayable: false,
});

it("compacts folder chains and keeps snapshot indices after sorting", () => {
  const nodes = diffTree([file("src/notes/z.ts"), file("index.html"), file("src/notes/a.ts")], "");
  expect(nodes[0]).toMatchObject({
    kind: "folder",
    name: "src / notes",
    children: [
      { name: "a.ts", index: 2 },
      { name: "z.ts", index: 0 },
    ],
  });
  expect(nodes[1]).toMatchObject({ name: "index.html", index: 1 });
});

it("searches full paths and keeps only the matching branches", () => {
  const nodes = diffTree(
    [file("internal/notes/list.go"), file("web/src/feed.css")],
    "INTERNAL list",
  );
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({
    name: "internal / notes",
    children: [{ name: "list.go", index: 0 }],
  });
  expect(diffTree([file("index.ts")], "missing")).toEqual([]);
});

it("keeps identical paths in separate repositories", () => {
  const nodes = diffTree([file("src/index.ts", "api"), file("src/index.ts", "web")], "");
  expect(nodes.map((node) => node.name)).toEqual(["api", "web"]);
  expect(
    diffTree([file("src/index.ts", "api"), file("src/index.ts", "web")], "web")[0],
  ).toMatchObject({ name: "web", children: [{ name: "src", children: [{ index: 1 }] }] });
});
