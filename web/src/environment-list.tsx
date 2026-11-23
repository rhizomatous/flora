import { useEffect, useRef } from "react";

import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  PencilIcon,
  SettingsGroup,
  Text,
} from "@flora/florets";

import type { EnvironmentVariable } from "./environment-state";

function valueLabel(value: EnvironmentVariable & { removed?: boolean }) {
  if (value.removed === true) return "Removed";
  if (value.secret) return "••••••••";
  return value.value === undefined || value.value === "" ? "Empty value" : value.value;
}
export function EnvironmentList({
  values,
  onEdit,
  focusOnMount = false,
}: {
  values: (EnvironmentVariable & { removed?: boolean })[];
  onEdit: (value: EnvironmentVariable, trigger: HTMLButtonElement) => void;
  focusOnMount?: boolean;
}) {
  const firstRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) firstRow.current?.focus();
  }, [focusOnMount]);
  return (
    <SettingsGroup className="overflow-hidden">
      <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
        {values.length} {values.length === 1 ? "variable" : "variables"}
      </div>
      {values.length === 0 ? (
        <Text tone="muted" className="px-4 py-6">
          No environment variables
        </Text>
      ) : (
        <ul aria-label="Environment variables" className="divide-y divide-border">
          {values.map((value, index) => (
            <Item key={value.name} size="list" render={<li />} className="rounded-none p-0!">
              <button
                ref={index === 0 ? firstRow : undefined}
                type="button"
                aria-label={`Edit ${value.name}`}
                className="flex w-full min-w-0 items-center gap-4 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={(event) => {
                  onEdit(value, event.currentTarget);
                }}
              >
                <ItemContent className="sm:flex-col! sm:items-start! sm:gap-1!">
                  <ItemTitle className="w-full! font-mono">{value.name}</ItemTitle>
                  {value.description !== undefined && value.description !== "" && (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {value.description}
                    </span>
                  )}
                </ItemContent>
                <ItemActions className="min-w-0 shrink-0">
                  <span
                    className="max-w-24 truncate font-mono text-xs text-muted-foreground sm:max-w-48"
                    aria-label={value.secret ? "Secret value" : undefined}
                  >
                    {valueLabel(value)}
                  </span>
                  <PencilIcon className="size-4 shrink-0 text-muted-foreground" />
                </ItemActions>
              </button>
            </Item>
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}
