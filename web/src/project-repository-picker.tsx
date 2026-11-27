import { useLayoutEffect, useRef, useState } from "react";

import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  GitHubLogoIcon,
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
  RefreshCwIcon,
  SettingsGroup,
} from "@flora/florets";

import type { GitHubRepository } from "./github-schemas";

export function ProjectRepositoryPicker({
  available,
  url,
  onSelect,
  onRefresh,
  accessPath,
  loading,
  required = false,
}: {
  available: GitHubRepository[];
  url: string;
  onSelect: (url: string) => void;
  onRefresh: () => void;
  accessPath: string;
  loading: boolean;
  required?: boolean;
}) {
  const externalAccess = accessPath.startsWith("https://github.com/");
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const selected = available.find((repository) =>
    [repository.html_url, `${repository.html_url}.git`].includes(url),
  );
  const choosing = url === "" || editing;
  const selection = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focus = useRef<"search" | "selection" | undefined>(undefined);
  useLayoutEffect(() => {
    if (focus.current === "search") search.current?.focus();
    else if (focus.current === "selection") selection.current?.focus();
    focus.current = undefined;
  });

  return (
    <SettingsGroup>
      {choosing ? (
        <>
          <Combobox
            inline
            open
            autoHighlight
            required={required}
            disabled={loading}
            items={available}
            value={selected ?? null}
            inputValue={query}
            onInputValueChange={setQuery}
            itemToStringLabel={(repository) => repository.full_name}
            onValueChange={(repository) => {
              if (!repository) return;
              focus.current = "selection";
              onSelect(repository.html_url);
              setEditing(false);
            }}
          >
            <ComboboxInput
              ref={search}
              aria-label="Choose a repository"
              placeholder="Search repositories"
              disabled={loading}
              showTrigger={false}
              onKeyDown={(event) => {
                if (event.key === "Escape" && editing) {
                  event.preventDefault();
                  event.stopPropagation();
                  focus.current = "selection";
                  setEditing(false);
                }
              }}
              className="h-11 w-full rounded-none border-0 bg-transparent shadow-none focus-within:ring-inset"
            />
            <div className="border-t border-border p-1">
              <ComboboxEmpty className="block px-3 py-0 [&:not(:empty)]:py-4">
                {loading ? "Loading repositories…" : "No matching repositories"}
              </ComboboxEmpty>
              <ComboboxList className="max-h-56 p-0">
                {(repository: GitHubRepository) => (
                  <ComboboxItem
                    key={repository.full_name}
                    value={repository}
                    className="min-h-11 min-w-0 gap-3 px-3 py-2 pr-8 whitespace-normal"
                  >
                    <GitHubLogoIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-all">{repository.full_name}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </div>
          </Combobox>
          <div className="p-1">
            <Item
              size="list"
              render={
                <a
                  href={accessPath}
                  aria-label="Manage GitHub access"
                  target={externalAccess ? "_blank" : undefined}
                  rel={externalAccess ? "noreferrer" : undefined}
                />
              }
            >
              <GitHubLogoIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <ItemContent>
                <ItemTitle>Manage GitHub access</ItemTitle>
              </ItemContent>
              <ItemActions>
                {externalAccess ? (
                  <ExternalLinkIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                )}
              </ItemActions>
            </Item>
            <Item
              size="list"
              className="h-auto justify-start text-left"
              render={
                <Button type="button" variant="ghost" disabled={loading} onClick={onRefresh} />
              }
            >
              <RefreshCwIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <ItemContent>
                <ItemTitle>Refresh repositories</ItemTitle>
              </ItemContent>
            </Item>
          </div>
        </>
      ) : (
        <Item
          size="list"
          className="h-auto justify-start px-4 py-3 text-left"
          render={
            <Button
              ref={selection}
              type="button"
              variant="ghost"
              aria-label="Change repository"
              onClick={() => {
                focus.current = "search";
                setQuery("");
                setEditing(true);
              }}
            />
          }
        >
          <GitHubLogoIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <ItemContent>
            <ItemTitle className="line-clamp-none break-all whitespace-normal!">
              {selected?.full_name ?? url.replace("https://github.com/", "").replace(/\.git$/, "")}
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          </ItemActions>
        </Item>
      )}
    </SettingsGroup>
  );
}
