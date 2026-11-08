export function exampleAnchor(title: string) {
  return `example-${title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")}`;
}

// Example modules use top-level function declarations. Keep the selected demo,
// its helper functions, and module-level imports/data together when copying.
export function sourceForExample(source: string, title: string | undefined) {
  if (title === undefined) return standaloneSource(source);
  // Template literals may contain complete function examples at column zero.
  // Preserve these modules intact instead of mistaking sample text for code.
  if (source.includes("`")) return standaloneSource(source);
  const declarations = [...source.matchAll(/^(?:export )?function (\w+)\([^]*?^\}$/gm)];
  const target = declarations.find((match) => match[0].includes(`title=${JSON.stringify(title)}`));
  if (target === undefined) return standaloneSource(source);
  const moduleData = source.replaceAll(/^(?:export )?function (\w+)\([^]*?^\}$/gm, "");
  const retained = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const name = declaration[1];
      if (name === undefined || retained.has(declaration)) continue;
      if (
        new RegExp(`\\b${name}\\b`).test(moduleData) ||
        [...retained].some((item) => new RegExp(`\\b${name}\\b`).test(item[0]))
      ) {
        retained.add(declaration);
        changed = true;
      }
    }
  }
  let result = source;
  for (const declaration of declarations.toReversed()) {
    if (!retained.has(declaration)) {
      result =
        result.slice(0, declaration.index) +
        result.slice(declaration.index + declaration[0].length);
    }
  }
  const targetName = target[1];
  if (targetName !== undefined && !target[0].startsWith("export ")) {
    result = result.replace(`function ${targetName}(`, `export function ${targetName}(`);
  }
  return standaloneSource(result);
}

// Converts local demonstration imports into public package imports and embeds
// the small local helpers required by a copied example.
export function standaloneSource(source: string, animationSource?: string) {
  let result = source.replaceAll(/from "(?:\.\.\/)+src\//g, 'from "@flora/florets/');
  result = result.replaceAll(
    /import \{([^}]+)\} from "(?:(?:\.\.\/)+ai\/lib\/ai|\.\.\/lib\/ai)";/g,
    (_, bindings: string) => {
      const names = bindings.split(",").map((name) => name.trim());
      const publicNames = names.filter((name) => name !== "getMessageText");
      const imported =
        publicNames.length === 0
          ? ""
          : `import { ${publicNames.join(", ")} } from "@shadcn/helpers/ai-sdk";`;
      const helper = names.includes("getMessageText")
        ? '\n\nfunction getMessageText(message: { parts: readonly { type: string; text?: string }[] }) {\n  return message.parts.flatMap((part) => part.type === "text" ? [part.text ?? ""] : []).join("");\n}'
        : "";
      return imported + helper;
    },
  );
  if (animationSource !== undefined) {
    result = result.replaceAll(
      /import \{[^}]+\} from "\.\.\/lib\/message-animations";/g,
      animationSource,
    );
  }
  return result
    .replaceAll(/^import \{ Example, ExampleWrapper \} from "\.\.\/example";\n?/gm, "")
    .replaceAll(/^import \{ PreviewImage as Image \} from "\.\.\/preview-image";\n?/gm, "")
    .replaceAll(
      /<Example(?:Wrapper)?\b([^>]*)>/g,
      (_, attributes: string) =>
        `<div${attributes.replaceAll(/\s+(?:title|containerClassName)="[^"]*"/g, "")}>`,
    )
    .replaceAll(/<\/Example(?:Wrapper)?>/g, "</div>")
    .replaceAll(/<Image\b/g, "<img")
    .replaceAll(/\s+fill(?=\s|\/?>)/g, "")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}
