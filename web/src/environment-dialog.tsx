import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  FieldLabel,
  Input,
  PlusIcon,
  RadioGroup,
  RadioGroupItem,
  Text,
  TextareaPanel,
  TextareaPanelInput,
  ArrowUpIcon,
  ChevronLeftIcon,
} from "@flora/florets";

import { EnvironmentFields } from "./environment-fields";
import { parseEnvironmentFile, type EnvironmentChange } from "./environment-import";
import { EnvironmentList } from "./environment-list";
import { blankVariable, type EnvironmentRow } from "./environment-row";
import { environmentSchema, useEnvironment, type EnvironmentVariable } from "./environment-state";
import { errorMessage, request } from "./request";

type Props = {
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: EnvironmentVariable | undefined;
  projectPath?: string | undefined;
  draft?: EnvironmentChange[] | undefined;
  onDraft?: ((changes: EnvironmentChange[]) => void) | undefined;
  onSaved?: ((values: EnvironmentVariable[]) => void) | undefined;
  finalFocus: RefObject<HTMLButtonElement | null>;
};
const formDrafts = new Map<string, EnvironmentRow[]>();
const scopeDrafts = new Map<string, string>();
const pasteDrafts = new Map<string, string>();
function toRow(value: EnvironmentVariable, pending?: EnvironmentChange): EnvironmentRow {
  return {
    ...value,
    description: value.description ?? "",
    value: value.value ?? "",
    action: value.secret ? "keep" : "set",
    ...pending,
    key: crypto.randomUUID(),
    saved: true,
  };
}
function changesFrom(rows: EnvironmentRow[]): EnvironmentChange[] {
  return rows.map(({ name, value, secret, action, description }) => ({
    name,
    value: action === "keep" || action === "remove" ? undefined : value,
    secret,
    action,
    description,
  }));
}
function mergeChanges(previous: EnvironmentChange[], changes: EnvironmentChange[]) {
  const names = new Set(changes.map((c) => c.name));
  return [...previous.filter((c) => !names.has(c.name)), ...changes];
}

export function EnvironmentDialog(props: Props) {
  const {
    path,
    open,
    onOpenChange,
    editing,
    projectPath,
    draft = [],
    onDraft,
    onSaved,
    finalFocus,
  } = props;
  const { values, setValues, error: loadError, refresh } = useEnvironment(path);
  const draftKey = `${path}:${editing?.name ?? "new"}`;
  const [rows, setRows] = useState<EnvironmentRow[]>(
    () =>
      formDrafts.get(draftKey) ?? [
        editing
          ? toRow(
              editing,
              draft.find((c) => c.name === editing.name),
            )
          : blankVariable(),
      ],
  );
  const [selected, setSelected] = useState<EnvironmentVariable | undefined>(editing);
  const [view, setView] = useState<"entry" | "list" | "paste">("entry");
  const [scope, setScope] = useState(() => scopeDrafts.get(draftKey) ?? "chat");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState(() => pasteDrafts.get(draftKey) ?? "");
  const firstInput = useRef<HTMLInputElement>(null);
  const pasteInput = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error || loadError) alert.current?.focus();
  }, [error, loadError]);
  useEffect(() => {
    if (view === "paste") pasteInput.current?.focus();
  }, [view]);
  const formKey = `${path}:${selected?.name ?? "new"}`;
  function update(next: EnvironmentRow[]) {
    setRows(next);
    formDrafts.set(formKey, next);
    setError("");
  }
  function addImported(text: string) {
    try {
      const imported = parseEnvironmentFile(text).map((c) => ({
        ...c,
        key: crypto.randomUUID(),
        saved: false,
      }));
      const previous = rows.filter((r) => r.name !== "" || r.value !== "");
      const next = [...previous, ...imported];
      if (next.length > 100) throw new Error("Configure at most 100 environment variables.");
      if (new Set(next.map((r) => r.name)).size !== next.length) {
        throw new Error("Each variable name must appear only once.");
      }
      update(next);
      setView("entry");
      setPaste("");
      pasteDrafts.delete(draftKey);
    } catch (e) {
      setError(errorMessage(e, "Could not import environment variables."));
    }
  }
  async function readFile(upload: File) {
    try {
      if (upload.size > 65_536) throw new Error("Import a .env file of at most 64 KiB.");
      addImported(await upload.text());
    } catch (e) {
      setError(errorMessage(e, "Could not read the .env file."));
    }
  }
  const displayValues = new Map<string, EnvironmentVariable & { removed?: boolean }>(
    (values ?? []).map((v) => [v.name, v]),
  );
  for (const change of draft) {
    const original = displayValues.get(change.name);
    displayValues.set(change.name, {
      name: change.name,
      secret: change.secret,
      value: change.secret ? "" : (change.value ?? original?.value ?? ""),
      description: change.description ?? original?.description ?? "",
      removed: change.action === "remove",
    });
  }
  function edit(value: EnvironmentVariable) {
    setSelected(value);
    setRows(
      formDrafts.get(`${path}:${value.name}`) ?? [
        toRow(
          value,
          draft.find((c) => c.name === value.name),
        ),
      ],
    );
    setError("");
    setScope("chat");
    setView("entry");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const changes = changesFrom(rows);
      if (
        !onDraft &&
        !selected &&
        changes.some((c) => values?.some((v) => v.name === c.name) === true)
      ) {
        throw new Error("That variable already exists. Edit it from the list.");
      }
      if (onDraft) {
        if (scope === "project" && projectPath !== undefined) {
          const projectValues = await request(environmentSchema.array(), projectPath);
          if (!selected && changes.some((c) => projectValues.some((v) => v.name === c.name))) {
            throw new Error("That project variable already exists. Edit it in Project settings.");
          }
          await request(environmentSchema.array(), projectPath, { method: "PATCH", body: changes });
          const names = new Set(changes.map((c) => c.name));
          onDraft(draft.filter((c) => !names.has(c.name)));
          refresh();
          toast.success("Project variables saved");
        } else {
          const next = mergeChanges(draft, changes);
          await request(environmentSchema.array(), path, { method: "POST", body: next });
          onDraft(next);
        }
      } else {
        const next = await request(environmentSchema.array(), path, {
          method: "PATCH",
          body: changes,
        });
        setValues(next);
        onSaved?.(next);
        toast.success("Environment variables saved");
      }
      formDrafts.delete(formKey);
      scopeDrafts.delete(draftKey);
      setRows([blankVariable()]);
      setSelected(undefined);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, "Could not save environment variables."));
    } finally {
      setBusy(false);
    }
  }
  const removing = rows.length === 1 && rows[0]?.action === "remove";
  let saveLabel = selected ? "Save changes" : `Add ${rows.length === 1 ? "variable" : "variables"}`;
  if (onDraft && !selected) {
    saveLabel =
      scope === "project"
        ? "Save to project"
        : `Use ${rows.length === 1 ? "variable" : "variables"}`;
  }
  if (removing) saveLabel = "Remove variable";
  if (busy) saveLabel = "Saving…";
  let title = selected ? "Edit environment variable" : "Add environment variables";
  if (view === "list") title = "Environment variables";
  if (view === "paste") title = "Import environment variables";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
        initialFocus={view === "paste" ? pasteInput : firstInput}
        className="flex! max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (view === "paste") addImported(paste);
            else if (view === "entry" && !busy && values !== undefined && !loadError) void save();
          }}
        >
          <div className="shrink-0 border-b border-border p-4 pr-12">
            <DialogTitle>{title}</DialogTitle>
          </div>
          <div
            className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4"
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              if (
                view === "entry" &&
                !selected &&
                (text.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/gmu)?.length ?? 0) > 1
              ) {
                event.preventDefault();
                addImported(text);
              }
            }}
          >
            {(error || loadError) && (
              <Alert ref={alert} tabIndex={-1} role="alert" variant="destructive">
                {error || loadError}
                {loadError && (
                  <Button type="button" variant="ghost" onClick={refresh}>
                    Retry
                  </Button>
                )}
              </Alert>
            )}
            {view === "list" && (
              <>
                {values ? (
                  <EnvironmentList
                    values={[...displayValues.values()].toSorted((a, b) =>
                      a.name.localeCompare(b.name),
                    )}
                    onEdit={edit}
                    focusOnMount
                  />
                ) : (
                  <Text role="status">Loading environment variables…</Text>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelected(undefined);
                    setRows(formDrafts.get(`${path}:new`) ?? [blankVariable()]);
                    setView("entry");
                  }}
                >
                  <PlusIcon />
                  Add variable
                </Button>
              </>
            )}
            {view === "paste" && (
              <div className="space-y-2">
                <FieldLabel htmlFor="environment-paste">Paste .env</FieldLabel>
                <TextareaPanel>
                  <TextareaPanelInput
                    ref={pasteInput}
                    id="environment-paste"
                    value={paste}
                    onChange={(e) => {
                      setPaste(e.target.value);
                      pasteDrafts.set(draftKey, e.target.value);
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={"CLIENT_KEY=value\nSERVICE_URL=https://example.test"}
                    className="min-h-48 font-mono"
                  />
                </TextareaPanel>
              </div>
            )}
            {view === "entry" && (
              <>
                {onDraft && !selected && (
                  <fieldset className="space-y-3">
                    <legend className="mb-3 text-sm font-medium">Available to</legend>
                    <RadioGroup
                      aria-label="Available to"
                      value={scope}
                      onValueChange={(value) => {
                        if (typeof value === "string") {
                          setScope(value);
                          scopeDrafts.set(draftKey, value);
                        }
                      }}
                      className="grid-cols-2"
                    >
                      {[
                        { value: "chat", label: "This chat" },
                        { value: "project", label: "Project" },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface-panel p-4 text-sm has-data-checked:border-ring has-data-checked:bg-control-hover"
                        >
                          {option.label}
                          <RadioGroupItem value={option.value} disabled={busy} />
                        </label>
                      ))}
                    </RadioGroup>
                  </fieldset>
                )}
                <EnvironmentFields
                  rows={rows.map((row) => ({
                    ...row,
                    keepable:
                      values === undefined
                        ? undefined
                        : values.some((value) => value.name === row.name && value.secret),
                  }))}
                  onChange={update}
                  busy={busy}
                  invalid={error !== ""}
                  firstInput={firstInput}
                />
                {!selected && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={busy || rows.length >= 100}
                    onClick={() => {
                      update([...rows, blankVariable()]);
                    }}
                  >
                    <PlusIcon />
                    Add another variable
                  </Button>
                )}
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-overlay p-4">
            <div className="mr-auto flex flex-wrap gap-2">
              {view === "entry" && !selected && (
                <>
                  <Input
                    ref={file}
                    type="file"
                    accept=".env,text/plain"
                    className="hidden"
                    tabIndex={-1}
                    aria-label="Import .env file"
                    onChange={(event) => {
                      const upload = event.target.files?.[0];
                      event.target.value = "";
                      if (upload) void readFile(upload);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="compact"
                    disabled={busy}
                    onClick={() => {
                      file.current?.click();
                    }}
                  >
                    <ArrowUpIcon />
                    Import .env
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    disabled={busy}
                    onClick={() => {
                      setView("paste");
                      setError("");
                    }}
                  >
                    Paste .env
                  </Button>
                </>
              )}
              {view !== "entry" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={() => {
                    setView("entry");
                    setError("");
                  }}
                >
                  <ChevronLeftIcon />
                  Back
                </Button>
              )}
              {view === "entry" && onDraft && (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  disabled={busy}
                  onClick={() => {
                    setView("list");
                    setError("");
                  }}
                >
                  Variables
                </Button>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            {view === "entry" && (
              <Button
                type="submit"
                disabled={
                  busy ||
                  values === undefined ||
                  loadError !== "" ||
                  rows.every((row) => row.name === "" && (row.value ?? "") === "")
                }
              >
                {saveLabel}
              </Button>
            )}
            {view === "paste" && (
              <Button type="submit" disabled={!paste.trim()}>
                Review variables
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
