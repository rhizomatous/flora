import {
  BracesIcon,
  CodeIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  HashIcon,
  TerminalIcon,
} from "lucide-react";

import { fileLanguage } from "../lib/diff";

export function FileTypeIcon({ path }: { path: string }) {
  const language = fileLanguage(path);
  let Icon = FileIcon;
  let color = "text-muted-foreground";
  if (["go", "ts", "tsx", "js", "jsx", "rs", "py"].includes(language)) {
    Icon = CodeIcon;
    color = "text-sky-700 dark:text-sky-400";
  } else if (["css", "scss", "html"].includes(language)) {
    Icon = HashIcon;
    color = "text-violet-700 dark:text-violet-400";
  } else if (language === "json") {
    Icon = FileJsonIcon;
    color = "text-amber-700 dark:text-amber-400";
  } else if (["yaml", "yml", "toml"].includes(language)) {
    Icon = BracesIcon;
    color = "text-amber-700 dark:text-amber-400";
  } else if (["sh", "bash", "dockerfile", "makefile"].includes(language)) {
    Icon = TerminalIcon;
  } else if (["md", "txt"].includes(language)) Icon = FileTextIcon;
  return <Icon aria-hidden="true" className={`size-4 shrink-0 ${color}`} />;
}
