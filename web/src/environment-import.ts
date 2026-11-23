export type EnvironmentChange = {
  name: string;
  value?: string | undefined;
  secret: boolean;
  action: string;
  description?: string | undefined;
};

function closingQuote(text: string, quote: string, start: number) {
  for (let n = start; n < text.length; n++) {
    if (quote === '"' && text[n] === "\\") {
      n++;
      continue;
    }
    if (text[n] === quote) return n;
  }
  return -1;
}

// Parse literal dotenv values without executing shell syntax or expanding variables.
// Diagnostics identify line numbers and never include imported values.
export function parseEnvironmentFile(text: string): EnvironmentChange[] {
  if (new TextEncoder().encode(text).length > 65_536) {
    throw new Error("Import a .env file of at most 64 KiB.");
  }
  const lines = text
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .split("\n");
  const result: EnvironmentChange[] = [];
  const names = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) throw new Error(`Line ${i + 1}: enter a variable as NAME=value.`);
    const name = match[1] ?? "";
    let value = match[2] ?? "";
    if (names.has(name)) {
      throw new Error(`Line ${i + 1}: each variable name must appear only once.`);
    }
    names.add(name);
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      let literal = value.slice(1);
      let end = -1;
      let scanned = 0;
      for (;;) {
        end = closingQuote(literal, quote, scanned);
        if (end >= 0) break;
        i++;
        if (i >= lines.length) throw new Error("Close every quoted value before importing.");
        scanned = literal.length;
        literal += `\n${lines[i] ?? ""}`;
      }
      const tail = literal.slice(end + 1).trim();
      if (tail && !tail.startsWith("#")) {
        throw new Error(`Line ${i + 1}: remove text after the quoted value.`);
      }
      value = literal.slice(0, end);
      if (quote === '"') {
        value = value.replaceAll(/\\([nr"\\])/gu, (_, escape: string) => {
          if (escape === "n") return "\n";
          if (escape === "r") return "\r";
          return escape;
        });
      }
    } else {
      value = value.replace(/\s+#.*$/u, "").trimEnd();
    }
    result.push({ name, value, secret: true, action: "replace", description: "" });
  }
  if (result.length === 0) throw new Error("Add at least one NAME=value entry.");
  if (result.length > 100) throw new Error("Import at most 100 environment variables.");
  return result;
}
