import type { FileChange } from "./changes-schemas";

export type DiffTreeNode =
  | { kind: "file"; name: string; path: string; index: number; file: FileChange }
  | { kind: "folder"; name: string; path: string; children: DiffTreeNode[]; repository?: boolean };

// Retain the snapshot index when sorting and filtering so selection opens the original file.
export function diffTree(files: FileChange[], query: string): DiffTreeNode[] {
  const roots: DiffTreeNode[] = [];
  const multipleRepositories = new Set(files.map((file) => file.repository)).size > 1;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const folders = new Map<string, Extract<DiffTreeNode, { kind: "folder" }>>();
  for (const [index, file] of files.entries()) {
    const fullPath = `${file.repository ?? ""}/${file.path}`;
    if (!terms.every((term) => fullPath.toLowerCase().includes(term))) continue;
    const parts = file.path.split("/");
    if (multipleRepositories) parts.unshift(file.repository ?? "Repository");
    let children = roots;
    let path = "";
    for (const [depth, part] of parts.slice(0, -1).entries()) {
      path += `/${part}`;
      let folder = folders.get(path);
      if (!folder) {
        folder = {
          kind: "folder",
          name: part,
          path,
          children: [],
          repository: multipleRepositories && depth === 0,
        };
        folders.set(path, folder);
        children.push(folder);
      }
      children = folder.children;
    }
    children.push({ kind: "file", name: parts.at(-1) ?? file.path, path: fullPath, index, file });
  }
  return compact(roots);
}

function compact(nodes: DiffTreeNode[]): DiffTreeNode[] {
  return nodes
    .map((node) => {
      if (node.kind === "file") return node;
      let folder = node;
      while (
        folder.repository !== true &&
        folder.children.length === 1 &&
        folder.children[0]?.kind === "folder"
      ) {
        const child = folder.children[0];
        folder = { ...child, name: `${folder.name} / ${child.name}` };
      }
      return { ...folder, children: compact(folder.children) };
    })
    .toSorted((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}
