import { useMemo, useRef, useState } from "react";

import {
  Button,
  ChevronDownIcon,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  FileTypeIcon,
  FolderIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@flora/florets";

import { changeStatus, type FileChange } from "./changes-schemas";
import { diffTree, type DiffTreeNode } from "./diff-tree";

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
  const [query, setQuery] = useState("");
  const nodes = useMemo(() => diffTree(files, query), [files, query]);
  const destination = useRef<HTMLElement | undefined>(undefined);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          destination.current = undefined;
          setQuery("");
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" aria-label="Files" className="text-muted-foreground">
            Files <span className="opacity-60">{files.length}</span>
            <ChevronDownIcon />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-96! max-w-[calc(100vw-24px)]! p-0"
        aria-label="Changed files"
        finalFocus={() => destination.current ?? true}
      >
        <Command shouldFilter={false} className="rounded-lg! p-0">
          <CommandInput
            variant="plain"
            value={query}
            onValueChange={setQuery}
            aria-label="Search changed files"
            placeholder="Search"
          />
          <CommandList aria-label="Changed files" className="p-1.5">
            <CommandEmpty>No matching files.</CommandEmpty>
            <FileTree
              nodes={nodes}
              onSelect={(index) => {
                destination.current = onSelect(index);
                setOpen(false);
              }}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FileTree({
  nodes,
  onSelect,
}: {
  nodes: DiffTreeNode[];
  onSelect: (index: number) => void;
}) {
  return nodes.map((node) =>
    node.kind === "folder" ? (
      <div key={node.path} role="group" aria-label={node.name}>
        <div className="flex h-7 items-center gap-2 px-2 text-sm text-muted-foreground">
          <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate" title={node.name}>
            {node.name}
          </span>
        </div>
        <div className="ml-3 border-l border-border pl-2">
          <FileTree nodes={node.children} onSelect={onSelect} />
        </div>
      </div>
    ) : (
      <CommandItem
        key={node.path}
        value={node.path}
        title={node.path}
        className="min-h-7 gap-2 rounded-sm py-1 [&>svg:last-child]:hidden"
        onSelect={() => {
          onSelect(node.index);
        }}
      >
        <FileTypeIcon path={node.file.path} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.file.status !== "M" && (
          <span className="text-xs text-muted-foreground">{changeStatus(node.file.status)}</span>
        )}
        <ChangeCounts additions={node.file.additions} deletions={node.file.deletions} />
      </CommandItem>
    ),
  );
}
