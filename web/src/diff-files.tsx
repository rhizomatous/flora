import { useRef, useState } from "react";

import {
  Button,
  ChevronDownIcon,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  FileTypeIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@flora/florets";

import { changeStatus, type FileChange } from "./changes-schemas";

export function ChangeCounts({
  additions,
  deletions,
}: {
  additions: number | undefined;
  deletions: number | undefined;
}) {
  if (additions === undefined || deletions === undefined) return null;
  return (
    <span
      className="ml-auto inline-flex shrink-0 gap-2 text-xs tabular-nums"
      aria-label={`${additions} additions, ${deletions} deletions`}
    >
      <span className="text-emerald-700 dark:text-emerald-400">+{additions}</span>
      <span className="text-red-700 dark:text-red-400">−{deletions}</span>
    </span>
  );
}

export function DiffFiles({
  files,
  onSelect,
}: {
  files: FileChange[];
  onSelect: (index: number) => HTMLElement | undefined;
}) {
  const [open, setOpen] = useState(false);
  const destination = useRef<HTMLElement | undefined>(undefined);
  const multipleRepositories = new Set(files.map((file) => file.repository)).size > 1;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) destination.current = undefined;
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" aria-label="Files">
            Files {files.length}
            <ChevronDownIcon />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-96! max-w-[calc(100vw-24px)]! p-0"
        aria-label="Changed files"
        finalFocus={() => destination.current ?? true}
      >
        <Command>
          <CommandInput aria-label="Search changed files" placeholder="Search files…" />
          <CommandList aria-label="Changed files">
            <CommandEmpty>No matching files.</CommandEmpty>
            {files.map((file, index) => (
              <CommandItem
                key={`${file.repository ?? ""}:${file.path}`}
                value={`${file.repository ?? ""}/${file.path}`}
                onSelect={() => {
                  destination.current = onSelect(index);
                  setOpen(false);
                }}
              >
                <FileTypeIcon path={file.path} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{file.path}</span>
                  <span className="text-xs text-muted-foreground">
                    {multipleRepositories ? `${file.repository ?? "Repository"} · ` : ""}
                    {changeStatus(file.status)}
                  </span>
                </span>
                <ChangeCounts additions={file.additions} deletions={file.deletions} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
