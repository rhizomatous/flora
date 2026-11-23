import { useEffect, useId, useRef, type RefObject } from "react";

import {
  Button,
  FieldLabel,
  Input,
  NativeSelect,
  SettingsGroup,
  SettingsRow,
  Switch,
  TextareaPanel,
  TextareaPanelInput,
  Trash2Icon,
} from "@flora/florets";

import type { EnvironmentRow } from "./environment-row";

export function EnvironmentFields({
  rows,
  onChange,
  busy,
  invalid,
  firstInput,
}: {
  rows: EnvironmentRow[];
  onChange: (rows: EnvironmentRow[]) => void;
  busy: boolean;
  invalid: boolean;
  firstInput: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const previousCount = useRef(rows.length);
  useEffect(() => {
    if (rows.length > previousCount.current) {
      root.current?.querySelector<HTMLInputElement>("section:last-child input")?.focus();
    }
    previousCount.current = rows.length;
  }, [rows.length]);
  useEffect(() => {
    firstInput.current?.focus();
  }, [firstInput]);
  function edit(key: string, change: Partial<EnvironmentRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }
  return (
    <div ref={root} className="space-y-8">
      {rows.map((row, index) => (
        <section
          key={row.key}
          className="space-y-4"
          aria-label={rows.length > 1 ? `Variable ${index + 1}` : undefined}
        >
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <FieldLabel htmlFor={`${id}-${index}-name`}>Key</FieldLabel>
              <Input
                ref={index === 0 ? firstInput : undefined}
                id={`${id}-${index}-name`}
                value={row.name}
                readOnly={row.saved}
                disabled={busy}
                placeholder="CLIENT_KEY"
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
                aria-invalid={
                  invalid &&
                  (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(row.name) ||
                    rows.filter((r) => r.name === row.name).length > 1)
                }
                onChange={(e) => {
                  edit(row.key, { name: e.target.value });
                }}
                className="font-mono"
              />
            </div>
            {!row.saved && rows.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${row.name || "variable"}`}
                disabled={busy}
                onClick={() => {
                  onChange(rows.filter((r) => r.key !== row.key));
                }}
              >
                <Trash2Icon />
              </Button>
            )}
          </div>
          {row.saved && (
            <SettingsGroup>
              <SettingsRow label="Action" htmlFor={`${id}-${index}-action`}>
                <NativeSelect
                  id={`${id}-${index}-action`}
                  width="content"
                  value={row.action}
                  disabled={busy}
                  onChange={(e) => {
                    edit(row.key, { action: e.target.value, value: row.secret ? "" : row.value });
                  }}
                >
                  {(!row.secret || row.keepable !== false) && (
                    <option value={row.secret ? "keep" : "set"}>
                      {row.secret ? "Keep secret" : "Edit value"}
                    </option>
                  )}
                  {row.secret && <option value="replace">Replace secret</option>}
                  <option value="remove">Remove variable</option>
                </NativeSelect>
              </SettingsRow>
            </SettingsGroup>
          )}
          {row.action !== "keep" && row.action !== "remove" && (
            <div className="space-y-2">
              <FieldLabel htmlFor={`${id}-${index}-value`}>Value</FieldLabel>
              <Input
                id={`${id}-${index}-value`}
                value={row.value ?? ""}
                type={row.secret ? "password" : "text"}
                placeholder="Enter a value"
                disabled={busy}
                maxLength={8192}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={invalid && row.secret && (row.value ?? "") === ""}
                onChange={(e) => {
                  edit(row.key, { value: e.target.value });
                }}
                className="font-mono"
              />
            </div>
          )}
          {row.action !== "remove" && (
            <div className="space-y-2">
              <FieldLabel htmlFor={`${id}-${index}-description`}>
                Description <span className="font-normal text-muted-foreground">Optional</span>
              </FieldLabel>
              <TextareaPanel>
                <TextareaPanelInput
                  id={`${id}-${index}-description`}
                  value={row.description ?? ""}
                  onChange={(e) => {
                    edit(row.key, { description: e.target.value });
                  }}
                  placeholder="What is this variable for?"
                  maxLength={512}
                  disabled={busy}
                  className="min-h-16"
                />
              </TextareaPanel>
            </div>
          )}
          {!row.saved && (
            <details className="text-sm">
              <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Options
              </summary>
              <SettingsGroup className="mt-3">
                <SettingsRow label="Secret" htmlFor={`${id}-${index}-secret`}>
                  <Switch
                    id={`${id}-${index}-secret`}
                    checked={row.secret}
                    disabled={busy}
                    onCheckedChange={(checked) => {
                      edit(row.key, { secret: checked, action: checked ? "replace" : "set" });
                    }}
                  />
                </SettingsRow>
              </SettingsGroup>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
