import { preferenceFields, type Preferences } from "./preferences";
import { control } from "./ui";

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
    <fieldset disabled={busy} className="space-y-6 border-t border-foreground/20 pt-6">
      <legend className="text-base font-semibold">Defaults and limits</legend>
      <p className="text-sm leading-6 text-muted-foreground">
        CPU, memory, processes, setup timeout and Git author apply only to new chats. Existing chats
        keep their saved values, including when restarted. Older chats keep the original defaults.
      </p>
      <p className="text-sm leading-6 text-muted-foreground">
        Capacity applies to future starts, including stopped chats. Lowering it never stops running
        containers. Activity timeout applies at the next check to all active work, including work
        already in progress. Idle time and user-question waits do not count.
      </p>
      <p className="text-sm leading-6 text-muted-foreground">
        Message limits apply to new submissions. Diff thresholds apply when viewing saved diffs;
        full downloads remain available. Session lifetime applies at the next login, with no
        extension on use. Existing sessions keep their expiry. To hear completion alerts, save sound
        as enabled and use the Enable notification sound button on each fresh page.
      </p>
      {override !== undefined && (
        <p role="note" className="text-sm">
          The startup flag -max-running overrides the saved cap with {override}. Remove the flag and
          restart Flora to use the saved cap.
        </p>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        {preferenceFields.map((f) => (
          <div key={f.name}>
            <label className="block text-sm font-medium" htmlFor={f.name}>
              {f.label}
            </label>
            <input
              id={f.name}
              key={String(value[f.name])}
              className={control}
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
      <label className="block text-sm font-medium">
        Git author name
        <input
          key={value.authorName}
          className={control}
          name="authorName"
          required
          maxLength={200}
          defaultValue={value.authorName}
        />
      </label>
      <label className="block text-sm font-medium">
        Git author email
        <input
          key={value.authorEmail}
          className={control}
          name="authorEmail"
          type="email"
          required
          maxLength={254}
          defaultValue={value.authorEmail}
        />
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input
          key={String(value.sound)}
          name="sound"
          type="checkbox"
          defaultChecked={value.sound}
        />
        Play a sound when a chat finishes work
      </label>
    </fieldset>
  );
}
