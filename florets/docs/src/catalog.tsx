import { useState, type ComponentType } from "react";

import { Button, Input } from "@flora/florets";

const modules = import.meta.glob<{ Example: ComponentType<{ dark: boolean }> }>(
  "./examples/*.tsx",
  { eager: true },
);
const sources = import.meta.glob<string>("./examples/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
});
const examples = Object.entries(modules)
  .map(([path, module]) => ({
    name: path.slice("./examples/".length, -".tsx".length),
    Component: module.Example,
    source: sources[path] ?? "",
  }))
  .toSorted((a, b) => a.name.localeCompare(b.name));

export function Catalog({ dark }: { dark: boolean }) {
  const [query, setQuery] = useState("");
  const visible = examples.filter(({ name }) => name.includes(query.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Find a component"
          placeholder="Find a component…"
          className="max-w-sm"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <span role="status" className="text-sm text-muted-foreground">
          {visible.length} of {examples.length} components
        </span>
        {query !== "" && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
            }}
          >
            Clear search
          </Button>
        )}
      </div>
      {visible.length === 0 && <p>No components match your search.</p>}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {visible.map(({ name, Component, source }) => (
          <article
            key={name}
            id={`example-${name}`}
            aria-labelledby={`example-${name}-title`}
            className="min-w-0 scroll-mt-8 rounded-2xl border bg-card text-card-foreground"
          >
            <h3 id={`example-${name}-title`} className="border-b px-5 py-4 text-sm font-semibold">
              <a href={`#example-${name}`}>{name}</a>
            </h3>
            <div className="flex min-h-40 min-w-0 items-center justify-center p-5">
              <Component dark={dark} />
            </div>
            <details className="rounded-b-2xl border-t bg-muted/30">
              <summary className="cursor-pointer px-5 py-3 text-xs font-medium">View code</summary>
              <pre
                tabIndex={0}
                aria-label={`${name} example code`}
                className="max-h-96 overflow-auto px-5 pb-5 text-xs leading-6"
              >
                <code>{source}</code>
              </pre>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
