import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateManifest } from "material-icon-theme";
import type { Plugin } from "vite";

export function fileIcons(): Plugin {
  const id = "virtual:flora-file-icons";
  const manifest = generateManifest();
  const root = dirname(fileURLToPath(import.meta.resolve("material-icon-theme")));
  const names = manifest.fileNames ?? {};
  const extensions = manifest.fileExtensions ?? {};
  const lightNames = manifest.light?.fileNames ?? {};
  const lightExtensions = manifest.light?.fileExtensions ?? {};
  const fallback = manifest.file ?? "file";
  const used = new Set([
    fallback,
    ...Object.values(names),
    ...Object.values(extensions),
    ...Object.values(lightNames),
    ...Object.values(lightExtensions),
  ]);
  let serving = false;
  return {
    name: "flora-file-icons",
    configResolved(config) {
      serving = config.command === "serve";
    },
    async buildStart() {
      if (!serving) {
        this.emitFile({
          type: "asset",
          fileName: "material-icon-theme-LICENSE.txt",
          source: await readFile(resolve(root, "../../LICENSE")),
        });
      }
    },
    resolveId(source) {
      if (source === id) return `\0${id}`;
      return null;
    },
    async load(source) {
      if (source !== `\0${id}`) return;
      const assets = await Promise.all(
        [...used].map(async (name) => {
          const definition = manifest.iconDefinitions?.[name];
          if (!definition) throw new Error(`Missing file icon: ${name}`);
          // Manifest paths are relative to the package's dist directory, above its module entry.
          const path = resolve(root, "..", definition.iconPath);
          const url = serving
            ? JSON.stringify(`/@fs/${path}`)
            : `import.meta.ROLLUP_FILE_URL_${this.emitFile({
                type: "asset",
                name: `${name}.svg`,
                source: await readFile(path),
              })}`;
          return `${JSON.stringify(name)}:${url}`;
        }),
      );
      return `export default ${JSON.stringify({ names, extensions, lightNames, lightExtensions, fallback })};
export const icons = {${assets.join(",")}};`;
    },
  };
}
