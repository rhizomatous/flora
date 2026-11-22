import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";

import {
  Alert,
  Button,
  FieldLabel,
  Heading,
  Input,
  NativeSelect,
  Section,
  SectionHeader,
  SettingsGroup,
  Text,
  Trash2Icon,
  PlusIcon,
} from "@flora/florets";

import { errorMessage, request } from "./request";

const variableSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  secret: z.boolean(),
});
export type EnvironmentChange = {
  name: string;
  value?: string | undefined;
  secret: boolean;
  action: string;
};
type Row = EnvironmentChange & { key: string; saved: boolean; dirty?: boolean };
const rowsFrom = (values: z.infer<typeof variableSchema>[]): Row[] =>
  values.map((v) => ({
    ...v,
    value: v.value ?? "",
    action: v.secret ? "keep" : "set",
    key: crypto.randomUUID(),
    saved: true,
  }));

function EnvironmentFields({
  rows,
  onChange,
  busy,
  invalid,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  busy: boolean;
  invalid: boolean;
}) {
  const id = useId();
  const focusName = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusName.current) {
      root.current
        ?.querySelector<HTMLInputElement>("[data-environment-row]:last-child input")
        ?.focus();
      focusName.current = false;
    }
  });
  function edit(key: string, change: Partial<Row>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...change, dirty: true } : r)));
  }
  return (
    <div ref={root} className="space-y-4">
      {rows.length === 0 && (
        <Text tone="muted" className="px-4 py-3">
          No environment variables
        </Text>
      )}
      <SettingsGroup>
        {rows.map((r, i) => (
          <div key={r.key} data-environment-row className="space-y-3 p-4">
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <FieldLabel htmlFor={`${id}-${i}-name`}>Name</FieldLabel>
                <Input
                  id={`${id}-${i}-name`}
                  value={r.name}
                  placeholder="VARIABLE_NAME"
                  className="font-mono"
                  maxLength={128}
                  aria-invalid={
                    invalid &&
                    (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(r.name) ||
                      rows.filter((row) => row.name === r.name).length > 1)
                  }
                  disabled={busy || r.saved}
                  onChange={(e) => {
                    edit(r.key, { name: e.target.value });
                  }}
                  autoComplete="off"
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${r.name || "variable"}`}
                disabled={busy}
                onClick={() => {
                  if (r.saved) {
                    edit(r.key, {
                      action: r.action === "remove" ? (r.secret ? "keep" : "set") : "remove",
                      value: r.secret ? "" : r.value,
                    });
                  } else onChange(rows.filter((row) => row.key !== r.key));
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
            {r.action === "remove" ? (
              <div className="flex items-center justify-between gap-3">
                <Text tone="muted">Marked for removal</Text>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    edit(r.key, { action: r.secret ? "keep" : "set" });
                  }}
                >
                  Undo
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <FieldLabel htmlFor={`${id}-${i}-kind`}>Value</FieldLabel>
                  <NativeSelect
                    id={`${id}-${i}-kind`}
                    width="content"
                    value={r.secret ? "secret" : "ordinary"}
                    disabled={busy || (r.saved && r.secret)}
                    onChange={(e) => {
                      edit(r.key, {
                        secret: e.target.value === "secret",
                        action: e.target.value === "secret" ? "replace" : "set",
                        value: "",
                      });
                    }}
                  >
                    <option value="ordinary">Ordinary</option>
                    <option value="secret">Secret</option>
                  </NativeSelect>
                  {r.saved && r.secret && (
                    <NativeSelect
                      aria-label={`Secret action for ${r.name}`}
                      width="content"
                      value={r.action}
                      disabled={busy}
                      onChange={(e) => {
                        edit(r.key, { action: e.target.value, value: "" });
                      }}
                    >
                      <option value="keep">Keep secret</option>
                      <option value="replace">Replace secret</option>
                    </NativeSelect>
                  )}
                </div>
                {r.action !== "keep" && (
                  <Input
                    aria-label={`Value for ${r.name || "new variable"}`}
                    type={r.secret ? "password" : "text"}
                    aria-invalid={
                      invalid && r.secret && r.action === "replace" && (r.value ?? "") === ""
                    }
                    value={r.value}
                    disabled={busy}
                    maxLength={8192}
                    autoComplete="off"
                    placeholder={r.secret ? "Enter secret" : "Enter value"}
                    onChange={(e) => {
                      edit(r.key, { value: e.target.value });
                    }}
                    className="font-mono"
                  />
                )}
              </>
            )}
          </div>
        ))}
      </SettingsGroup>
      <Button
        type="button"
        variant="outline"
        disabled={busy || rows.length >= 100}
        onClick={() => {
          focusName.current = true;
          onChange([
            ...rows,
            {
              key: crypto.randomUUID(),
              name: "",
              value: "",
              secret: false,
              action: "set",
              saved: false,
              dirty: true,
            },
          ]);
        }}
      >
        <PlusIcon />
        Add variable
      </Button>
    </div>
  );
}

function changesFrom(rows: Row[]): EnvironmentChange[] {
  return rows.map(({ name, value, secret, action }) => ({
    name,
    value: action === "remove" || action === "keep" ? undefined : value,
    secret,
    action,
  }));
}

export function EnvironmentEditor({
  path,
  onDraft,
  draft,
  onEditing,
}: {
  path: string;
  onDraft?: (changes: EnvironmentChange[]) => void;
  draft?: EnvironmentChange[];
  onEditing?: (changes: EnvironmentChange[]) => void;
}) {
  const initialDraft = useRef(draft);
  const [rows, setRows] = useState<Row[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const values = await request(variableSchema.array(), path);
        if (!active) return;
        const next = rowsFrom(values);
        for (const change of initialDraft.current ?? []) {
          const existing = next.find((r) => r.name === change.name);
          if (existing) {
            Object.assign(existing, change, { value: change.value ?? "", dirty: true });
          } else {
            next.push({
              ...change,
              value: change.value ?? "",
              saved: false,
              dirty: true,
              key: crypto.randomUUID(),
            });
          }
        }
        setRows(next);
      } catch (e) {
        if (active) setError(errorMessage(e, "Could not load environment variables."));
      }
    }
    void load();
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retry reloads saved values after a failed request.
  }, [path, attempt]);
  async function save() {
    if (!rows) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const changes = changesFrom(onDraft ? rows.filter((r) => r.dirty === true) : rows);
      if (onDraft) {
        await request(variableSchema.array(), path, { method: "POST", body: changes });
        onDraft(changes);
        return;
      }
      const values = await request(variableSchema.array(), path, {
        method: "PATCH",
        body: changes,
      });
      setRows(rowsFrom(values));
      setNotice("Environment variables saved");
    } catch (e) {
      setError(errorMessage(e, "Could not save environment variables."));
    } finally {
      setBusy(false);
    }
  }
  let saveLabel = onDraft ? "Apply" : "Save environment variables";
  if (busy) saveLabel = "Saving…";
  const loading = error ? (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        setError("");
        setAttempt((a) => a + 1);
      }}
    >
      Retry
    </Button>
  ) : (
    <Text role="status">Loading environment variables…</Text>
  );
  return (
    <Section>
      {!onDraft && (
        <SectionHeader inset>
          <Heading level={2}>Environment variables</Heading>
        </SectionHeader>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      {notice && (
        <Text role="status" className="px-4">
          {notice}
        </Text>
      )}
      {rows ? (
        <>
          <EnvironmentFields
            rows={rows}
            onChange={(next) => {
              setRows(next);
              onEditing?.(changesFrom(next.filter((r) => r.dirty === true)));
            }}
            busy={busy}
            invalid={error !== ""}
          />
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                void save();
              }}
            >
              {saveLabel}
            </Button>
          </div>
        </>
      ) : (
        loading
      )}
    </Section>
  );
}
