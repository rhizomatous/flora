// oxlint-disable react/iframe-missing-sandbox -- The frame runs trusted local examples with module imports and interactive forms.
import { useEffect, useState } from "react";

import { Button, Input, NativeSelect, NativeSelectOption } from "@flora/florets";

import upstream from "./examples/upstream.json";

const sources = import.meta.glob<string>("./examples/upstream/*.tsx", {
  query: "?raw",
  import: "default",
});
const collections = upstream
  .map(({ name, url }) => ({
    name,
    url,
    source: sources[`./examples/upstream/${name}.tsx`],
  }))
  .toSorted((a, b) => a.name.localeCompare(b.name));

function selectedFromHash() {
  const name = location.hash.replace(/^#example-/, "");
  return collections.some((item) => item.name === name) ? name : "button";
}

export function Catalog({ dark }: { dark: boolean }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(selectedFromHash);
  const [source, setSource] = useState({ name: "", text: "" });
  const collection = collections.find(({ name }) => name === selected);
  const visible = collections.filter(({ name }) => name.includes(query.trim().toLowerCase()));

  useEffect(() => {
    function navigate() {
      if (location.hash.startsWith("#example-")) setSelected(selectedFromHash());
    }
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("hashchange", navigate);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function readSource() {
      try {
        const text = await collection?.source?.();
        if (active) setSource({ name: selected, text: text ?? "Source unavailable." });
      } catch {
        if (active) {
          setSource({ name: selected, text: "Source could not be loaded. Refresh to try again." });
        }
      }
    }
    void readSource();
    return () => {
      active = false;
    };
  }, [collection, selected]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Find a component"
          placeholder="Find a component…"
          className="max-w-xs"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <NativeSelect
          aria-label="Component examples"
          value={visible.some(({ name }) => name === selected) ? selected : ""}
          onChange={(event) => {
            const name = event.target.value;
            setSelected(name);
            history.replaceState(null, "", `#example-${name}`);
          }}
        >
          <NativeSelectOption value="" disabled>
            Choose a component
          </NativeSelectOption>
          {visible.map(({ name }) => (
            <NativeSelectOption key={name} value={name}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span role="status" className="text-sm text-muted-foreground">
          {visible.length} of {collections.length} collections
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{selected}</h3>
        <a
          className="text-sm underline underline-offset-4"
          href={`./example.html?component=${selected}&theme=${dark ? "dark" : "light"}`}
          target="_blank"
          rel="noreferrer"
        >
          Open full preview
        </a>
      </div>
      <iframe
        key={selected}
        title={`${selected} component examples`}
        src={`./example.html?component=${selected}&theme=${dark ? "dark" : "light"}`}
        className="h-[75svh] min-h-[32rem] w-full rounded-lg border bg-background"
      />
      <details key={`source-${selected}`} className="rounded-lg border bg-muted/30">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
          View example source
        </summary>
        <pre
          tabIndex={0}
          aria-label={`${selected} example source`}
          className="max-h-[32rem] overflow-auto px-5 pb-5 text-xs leading-6"
        >
          <code>{source.name === selected ? source.text : "Loading source…"}</code>
        </pre>
      </details>
    </div>
  );
}
