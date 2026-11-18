import { useState } from "react";

import {
  Button,
  CopyIcon,
  ExternalLinkIcon,
  EllipsisIcon,
  GitMergeIcon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  UsersIcon,
  TagIcon,
} from "@flora/florets";

import type { Pull } from "./pull-schemas";

export function PullActions({ pull }: { pull: Pull }) {
  const [copyLabel, setCopyLabel] = useState("Copy PR link");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
      <div className="flex items-center gap-1">
        <span
          aria-current="page"
          className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm font-medium"
        >
          Overview
        </span>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          role="link"
          render={
            <a
              href={`${pull.url}/files`}
              target="_blank"
              rel="noreferrer"
              aria-label="View PR diff on GitHub"
            />
          }
          aria-label="View PR diff on GitHub"
        >
          Diff
          <ExternalLinkIcon className="size-3! text-muted-foreground" />
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {pull.state === "open" && !pull.draft && (
          <Button
            size="sm"
            nativeButton={false}
            role="link"
            render={
              <a href={pull.url} target="_blank" rel="noreferrer" aria-label="Merge on GitHub" />
            }
            aria-label="Merge on GitHub"
          >
            <GitMergeIcon />
            Merge on GitHub
          </Button>
        )}
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) setCopyLabel("Copy PR link");
          }}
        >
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="PR actions">
                <EllipsisIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem
              nativeButton={false}
              render={
                <a
                  href={pull.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open PR on GitHub"
                />
              }
            >
              <ExternalLinkIcon />
              Open on GitHub
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(pull.url);
                    setCopyLabel("PR link copied");
                  } catch {
                    setCopyLabel("Could not copy link");
                  }
                })();
              }}
            >
              <CopyIcon />
              {copyLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              nativeButton={false}
              render={
                <a
                  href={pull.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Edit reviewers on GitHub"
                />
              }
            >
              <UsersIcon />
              Edit reviewers on GitHub
            </DropdownMenuItem>
            <DropdownMenuItem
              nativeButton={false}
              render={
                <a
                  href={pull.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Edit labels on GitHub"
                />
              }
            >
              <TagIcon />
              Edit labels on GitHub
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
