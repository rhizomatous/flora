export type FileIconManifest = {
  names: Record<string, string>;
  extensions: Record<string, string>;
  lightNames: Record<string, string>;
  lightExtensions: Record<string, string>;
  fallback: string;
};

function entry(mapping: Record<string, string>, name: string) {
  return Object.hasOwn(mapping, name) ? mapping[name] : undefined;
}

// Exact filenames win over extensions; longest suffixes win over shorter ones.
export function fileIcon(path: string, manifest: FileIconManifest, light = false) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  for (let index = 0; index < parts.length; index++) {
    const candidate = parts.slice(index).join("/");
    const named =
      (light ? entry(manifest.lightNames, candidate) : undefined) ??
      entry(manifest.names, candidate);
    if (named !== undefined) return named;
  }
  const name = parts.at(-1) ?? "";
  let dot = name.indexOf(".");
  while (dot >= 0) {
    const suffix = name.slice(dot + 1);
    const icon =
      (light ? entry(manifest.lightExtensions, suffix) : undefined) ??
      entry(manifest.extensions, suffix);
    if (icon !== undefined) return icon;
    dot = name.indexOf(".", dot + 1);
  }
  return manifest.fallback;
}
