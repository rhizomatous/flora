import { DropdownMenuItem, DropdownMenuGroup, Spinner } from "@flora/florets";

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

/** Search stays visible while rows scroll, and matches names, IDs, and providers across groups. */
export function ModelPicker({
  models,
  selected,
  loading,
  onSelect,
  inherited,
}: {
  inherited?: { label: string; selected: boolean; onSelect: () => void } | undefined;
  models: ModelOption[];
  selected: Execution | undefined;
  loading: boolean;
  onSelect: (model: ModelOption) => void;
}) {
  const groups = new Map<string, ModelOption[]>();
  for (const model of models) {
    const key = model.provider;
    const entries = groups.get(key) ?? [];
    entries.push(model);
    groups.set(key, entries);
  }
  return loading ? (
    <DropdownMenuItem value="loading" disabled className="text-muted-foreground">
      <Spinner />
      Loading models…
    </DropdownMenuItem>
  ) : (
    <>
      {inherited && (
        <DropdownMenuGroup className="border-b border-border p-1!">
          <DropdownMenuItem
            value={inherited.label}
            data-checked={inherited.selected}
            onSelect={inherited.onSelect}
          >
            {inherited.label}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      )}
      {[...groups.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([provider, entries]) => (
          <DropdownMenuGroup
            key={provider}
            className="border-t border-border p-1! first:border-t-0"
            label={
              <span className="flex items-center gap-2">
                <ModelIcon provider={provider} model={undefined} />
                {providerName(provider)}
              </span>
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
                <DropdownMenuItem
                  key={`${model.provider}/${model.id}`}
                  value={`${model.provider}/${model.id}`}
                  keywords={[model.name, model.id, model.provider, providerName(model.provider)]}
                  aria-label={model.name}
                  aria-description={description}
                  data-checked={
                    selected?.provider === model.provider && selected.model === model.id
                  }
                  className="gap-2 px-2 py-1 [&>svg:last-child]:ml-0 [&>svg:last-child]:size-3.5"
                  onSelect={() => {
                    onSelect(model);
                  }}
                >
                  <ModelIcon provider={model.provider} model={model.id} />
                  <span className="min-w-0 flex-1 truncate" title={model.name}>
                    {model.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-xs text-muted-foreground tabular-nums"
                    title={description}
                  >
                    {prices}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
    </>
  );
}
