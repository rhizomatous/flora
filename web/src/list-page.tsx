import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  Button,
  Empty,
  Heading,
  Input,
  SearchIcon,
  XIcon,
  ToggleGroup,
  ToggleGroupItem,
} from "@flora/florets";

/** Owns page heading and search focus while callers own filtering and results. */
export function ListPage({
  title,
  searchLabel,
  searchPlaceholder,
  closeSearchLabel,
  query,
  onQueryChange,
  actions,
  filters,
  children,
}: {
  title: string;
  searchLabel: string;
  searchPlaceholder: string;
  closeSearchLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  actions?: ReactNode;
  filters: ReactNode;
  children: ReactNode;
}) {
  const headingID = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);
  function closeSearch() {
    onQueryChange("");
    setSearching(false);
    searchButton.current?.focus();
  }
  return (
    <section aria-labelledby={headingID} className="flex min-h-0 flex-1 flex-col">
      <header className="florets-topbar flex shrink-0 items-center gap-2 border-b px-3">
        <span className="sidebar-toggle-space" aria-hidden="true" />
        <Heading
          level={1}
          id={headingID}
          ref={heading}
          tabIndex={-1}
          className="min-w-0 flex-1 text-base"
        >
          {title}
        </Heading>
        <Button
          variant="ghost"
          size="icon-sm"
          ref={searchButton}
          aria-label={searchLabel}
          aria-expanded={searching}
          onClick={() => {
            if (searching) closeSearch();
            else setSearching(true);
          }}
        >
          <SearchIcon />
        </Button>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {filters}
        {searching && (
          <div className="mb-4 flex items-center gap-2">
            <Input
              ref={search}
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeSearch();
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={closeSearchLabel}
              onClick={closeSearch}
            >
              <XIcon />
            </Button>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function ListFilters<T extends string>({
  label,
  options,
  value,
  onChange,
  children,
}: {
  label: string;
  options: readonly { id: T; label: string; count: number }[];
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <ToggleGroup
        aria-label={label}
        size="sm"
        variant="outline"
        value={[value]}
        onValueChange={(values) => {
          const selected = options.find((option) => option.id === values[0]);
          if (selected) onChange(selected.id);
        }}
        className="max-w-full flex-wrap gap-1.5"
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.id} value={option.id}>
            {option.label}
            <span className="text-xs text-muted-foreground">{option.count}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {children}
    </div>
  );
}

export function ListEmpty({ children }: { children: ReactNode }) {
  return (
    <Empty role="status" className="gap-2 py-12 text-sm text-muted-foreground">
      {children}
    </Empty>
  );
}
