import { useRef, useState } from "react";

import { Alert, Button, Heading, PlusIcon, Section, SectionHeader, Text } from "@flora/florets";

import { EnvironmentDialog } from "./environment-dialog";
import { EnvironmentList } from "./environment-list";
import { useEnvironment, type EnvironmentVariable } from "./environment-state";

export type { EnvironmentChange } from "./environment-import";

export function EnvironmentEditor({ path }: { path: string }) {
  const { values, setValues, error, refresh } = useEnvironment(path);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EnvironmentVariable>();
  const add = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const [version, setVersion] = useState(0);
  return (
    <Section>
      <SectionHeader inset className="flex-row items-center justify-between gap-4">
        <Heading level={2}>Environment variables</Heading>
        <Button
          ref={add}
          type="button"
          size="compact"
          variant="outline"
          disabled={values === undefined}
          onClick={() => {
            setEditing(undefined);
            returnFocus.current = add.current;
            setVersion((v) => v + 1);
            setOpen(true);
          }}
        >
          <PlusIcon />
          Add variable
        </Button>
      </SectionHeader>
      {error && (
        <Alert role="alert" variant="destructive">
          {error}
          <Button type="button" variant="ghost" onClick={refresh}>
            Retry
          </Button>
        </Alert>
      )}
      {values ? (
        <EnvironmentList
          values={values}
          onEdit={(value, trigger) => {
            setEditing(value);
            returnFocus.current = trigger;
            setVersion((v) => v + 1);
            setOpen(true);
          }}
        />
      ) : (
        !error && <Text role="status">Loading environment variables…</Text>
      )}
      <EnvironmentDialog
        key={`${path}:${editing?.name ?? "new"}:${version}`}
        path={path}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSaved={(next) => {
          setValues(next);
          if (editing && !next.some((v) => v.name === editing.name)) {
            returnFocus.current = add.current;
          }
        }}
        finalFocus={returnFocus}
      />
    </Section>
  );
}
