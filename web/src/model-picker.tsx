import { useRef, useState } from "react";

import {
  Button,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
  CommandGroup,
  ListIcon,
  Spinner,
} from "@flora/florets";

import type { Execution } from "./chat-schemas";
import { ModelIcon } from "./model-icon";
import type { ModelOption } from "./model-options";

function providerName(provider: string) {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "google") return "Google";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
const rateFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });
function rate(value: number) {
  return `$${rateFormat.format(value)}`;
}

function matchModel(value: string, query: string, keywords: string[] = []) {
  const content = [value, ...keywords].join(" ").toLowerCase();
  const compact = content.replaceAll(/[^\p{L}\p{N}]/gu, "");
  const terms = query.trim().toLowerCase().split(/\s+/u);
  return terms.every((term) => {
    const normalized = term.replaceAll(/[^\p{L}\p{N}]/gu, "");
    return content.includes(term) || (normalized !== "" && compact.includes(normalized));
  })
    ? 1
    : 0;
}

/** Search stays visible while rows scroll, and matches names, IDs, and providers across groups. */
export function ModelPicker({
  models,
  selected,
  loading,
  onSelect,
}: {
  models: ModelOption[];
  selected: Execution | undefined;
  loading: boolean;
  onSelect: (model: ModelOption) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const [grouped, setGrouped] = useState(() => {
    try {
      return localStorage.getItem("flora-model-grouping") !== "all";
    } catch {
      return true;
    }
  });
  const groups = new Map<string, ModelOption[]>();
  for (const model of models) {
    const key = grouped ? model.provider : "";
    const entries = groups.get(key) ?? [];
    entries.push(model);
    groups.set(key, entries);
  }
  return (
    <Command filter={matchModel} className="min-h-0 rounded-lg! p-0!">
      <div className="flex shrink-0 items-center border-b border-border pr-2">
        <div className="min-w-0 flex-1 [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:px-3">
          <CommandInput
            ref={search}
            variant="plain"
            className="h-12 text-base"
            aria-label="Search models"
            placeholder="Search models"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          aria-label="Group models by provider"
          aria-pressed={grouped}
          className="shrink-0 text-muted-foreground aria-pressed:text-foreground"
          onClick={() => {
            const next = !grouped;
            setGrouped(next);
            try {
              localStorage.setItem("flora-model-grouping", next ? "provider" : "all");
            } catch {
              /* Storage may be disabled. */
            }
            search.current?.focus();
          }}
        >
          <ListIcon />
          <span>By provider</span>
        </Button>
      </div>
      {loading ? (
        <div
          className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner />
          Loading models…
        </div>
      ) : (
        <CommandList className="max-h-[min(360px,calc(var(--available-height)-100px))] scroll-py-2">
          <CommandEmpty>No models found.</CommandEmpty>
          {[...groups.entries()]
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([provider, entries]) => (
              <CommandGroup
                key={provider}
                className="border-t border-border p-1.5! first:border-t-0"
                heading={
                  grouped ? (
                    <span className="flex items-center gap-2">
                      <ModelIcon provider={provider} model={undefined} />
                      {providerName(provider)}
                    </span>
                  ) : undefined
                }
              >
                {entries.map((model) => {
                  const { inputPrice, outputPrice } = model;
                  const priced = inputPrice !== null && outputPrice !== null;
                  const prices = priced ? `${rate(inputPrice)} / ${rate(outputPrice)}` : "–";
                  const description = priced
                    ? `Input ${rate(inputPrice)}, output ${rate(outputPrice)} per million tokens, USD.`
                    : "Pricing unavailable.";
                  return (
                    <CommandItem
                      key={`${model.provider}/${model.id}`}
                      value={`${model.provider}/${model.id}`}
                      keywords={[
                        model.name,
                        model.id,
                        model.provider,
                        providerName(model.provider),
                      ]}
                      aria-label={model.name}
                      aria-description={description}
                      data-checked={
                        selected?.provider === model.provider && selected.model === model.id
                      }
                      className="gap-2.5 px-2.5 py-2.5 [&>svg:last-child]:ml-0 [&>svg:last-child]:size-3.5"
                      onSelect={() => {
                        onSelect(model);
                      }}
                    >
                      <ModelIcon provider={model.provider} model={model.id} />
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-xs text-muted-foreground tabular-nums"
                        title={description}
                      >
                        {prices}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
        </CommandList>
      )}
      <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Input / output · USD per 1M tokens
      </div>
    </Command>
  );
}
