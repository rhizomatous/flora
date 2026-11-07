import { FieldSet, FieldDescription, FieldLabel, FieldLegend, Input } from "@flora/florets";

import { preferenceFields, type Preferences } from "./preferences";

export function PreferenceFields({
  value,
  busy,
  override,
}: {
  value: Preferences;
  busy: boolean;
  override: number | undefined;
}) {
  return (
    <FieldSet disabled={busy} className="border-t border-border pt-6">
      <FieldLegend className="mb-0">Defaults and limits</FieldLegend>
      <FieldDescription>
        CPU, memory, processes, setup timeout and Git author apply only to new chats. Existing chats
        keep their saved values, including when restarted. Older chats keep the original defaults.
      </FieldDescription>
      <FieldDescription>
        Capacity applies to future starts, including stopped chats. Lowering it never stops running
        containers. Activity timeout applies at the next check to all active work, including work
        already in progress. Idle time and user-question waits do not count.
      </FieldDescription>
      <FieldDescription>
        Message limits apply to new submissions. Diff thresholds apply when viewing saved diffs;
        full downloads remain available. Session lifetime applies at the next login, with no
        extension on use. Existing sessions keep their expiry. To hear completion alerts, save sound
        as enabled and use the Enable notification sound button on each fresh page.
      </FieldDescription>
      {override !== undefined && (
        <p role="note" className="text-sm">
          The startup flag -max-running overrides the saved cap with {override}. Remove the flag and
          restart Flora to use the saved cap.
        </p>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        {preferenceFields.map((f) => (
          <div key={f.name}>
            <FieldLabel htmlFor={f.name}>{f.label}</FieldLabel>
            <Input
              id={f.name}
              key={String(value[f.name])}
              className="mt-2"
              name={f.name}
              type="number"
              required
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              defaultValue={value[f.name]}
              aria-describedby={`${f.name}-range`}
            />
            <p id={`${f.name}-range`} className="mt-1 text-xs text-muted-foreground">
              {f.min.toLocaleString()} to {f.max.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
      <FieldLabel>
        Git author name
        <Input
          key={value.authorName}
          className="mt-2"
          name="authorName"
          required
          maxLength={200}
          defaultValue={value.authorName}
        />
      </FieldLabel>
      <FieldLabel>
        Git author email
        <Input
          key={value.authorEmail}
          className="mt-2"
          name="authorEmail"
          type="email"
          required
          maxLength={254}
          defaultValue={value.authorEmail}
        />
      </FieldLabel>
      <label className="flex items-center gap-3 text-sm">
        <input
          key={String(value.sound)}
          name="sound"
          type="checkbox"
          defaultChecked={value.sound}
        />
        Play a sound when a chat finishes work
      </label>
    </FieldSet>
  );
}
