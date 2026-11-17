import {
  AtomIcon,
  BracesIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  TerminalIcon,
} from "lucide-react";

import { fileLanguage } from "../lib/diff";

export function FileTypeIcon({ path }: { path: string }) {
  const language = fileLanguage(path);
  if (language === "tsx" || language === "jsx") {
    return (
      <AtomIcon aria-hidden="true" className="size-4 shrink-0 text-sky-700 dark:text-sky-400" />
    );
  }
  const badges: Record<string, { label: string; color: string }> = {
    ts: { label: "TS", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
    js: { label: "JS", color: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" },
    css: { label: "CSS", color: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
    scss: { label: "S", color: "bg-pink-500/15 text-pink-700 dark:text-pink-400" },
    html: { label: "#", color: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
    go: { label: "GO", color: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400" },
    py: { label: "PY", color: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" },
    rs: { label: "RS", color: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
  };
  const badge = badges[language];
  if (badge) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] font-mono text-[8px] leading-none font-semibold ${badge.color}`}
      >
        {badge.label}
      </span>
    );
  }
  let Icon = FileIcon;
  let color = "text-muted-foreground";
  if (language === "json") {
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
