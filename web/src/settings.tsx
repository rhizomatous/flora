export type Preferences = {
  cpus: number; memoryBytes: number; pidsLimit: number; setupSeconds: number;
  authorName: string; authorEmail: string; maxRunning: number; activitySeconds: number;
  inlineDiffBytes: number; messageBytes: number; sessionSeconds: number; sound: boolean;
};

const fields: { name: keyof Preferences; label: string; min: number; max: number; step?: number }[] = [
  { name: "maxRunning", label: "Maximum running containers", min: 1, max: 1000 },
  { name: "cpus", label: "CPUs per chat", min: 0.1, max: 256, step: 0.1 },
  { name: "memoryBytes", label: "Memory per chat (bytes)", min: 67108864, max: 1099511627776 },
  { name: "pidsLimit", label: "Processes per chat", min: 16, max: 65536 },
  { name: "setupSeconds", label: "Setup timeout (seconds)", min: 1, max: 86400 },
  { name: "activitySeconds", label: "Continuous-activity timeout (seconds)", min: 1, max: 604800 },
  { name: "inlineDiffBytes", label: "Inline diff threshold (bytes)", min: 1024, max: 16777216 },
  { name: "messageBytes", label: "Maximum message text (UTF-8 bytes)", min: 1024, max: 4194304 },
  { name: "sessionSeconds", label: "Absolute browser session lifetime (seconds)", min: 300, max: 31536000 },
];

export function readPreferences(form: FormData): Preferences {
  const result: Record<string, unknown> = {};
  for (const { name } of fields) result[name] = Number(form.get(name));
  result.authorName = form.get("authorName");
  result.authorEmail = form.get("authorEmail");
  result.sound = form.has("sound");
  return result as Preferences;
}

export function PreferenceFields({ value, control, busy, override }: { value: Preferences; control: string; busy: boolean; override?: number }) {
  return <fieldset disabled={busy} className="space-y-6 border-t border-foreground/20 pt-6">
    <legend className="text-base font-semibold">Defaults and limits</legend>
    <p className="text-sm leading-6 text-muted-foreground">CPU, memory, processes, setup timeout and Git author apply only to new chats. Existing chats keep their saved values, including when restarted. Older chats keep the original defaults.</p>
    <p className="text-sm leading-6 text-muted-foreground">Capacity applies to future starts, including stopped chats. Lowering it never stops running containers. Activity timeout applies at the next check to all active work, including work already in progress. Idle time and user-question waits do not count.</p>
    <p className="text-sm leading-6 text-muted-foreground">Message limits apply to new submissions. Diff thresholds apply when viewing saved diffs; full downloads remain available. Session lifetime applies at the next login, with no extension on use. Existing sessions keep their expiry. Sound applies in this browser after saving and interacting with the page.</p>
    {!!override && <p role="note" className="text-sm">The startup flag -max-running overrides the saved cap with {override}. Remove the flag and restart Flora to use the saved cap.</p>}
    <div className="grid gap-6 sm:grid-cols-2">{fields.map(f => <div key={f.name}><label className="block text-sm font-medium" htmlFor={f.name}>{f.label}</label><input id={f.name} key={String(value[f.name])} className={control} name={f.name} type="number" required min={f.min} max={f.max} step={f.step || 1} defaultValue={Number(value[f.name])} aria-describedby={`${f.name}-range`} /><p id={`${f.name}-range`} className="mt-1 text-xs text-muted-foreground">{f.min.toLocaleString()} to {f.max.toLocaleString()}</p></div>)}</div>
    <label className="block text-sm font-medium">Git author name<input key={value.authorName} className={control} name="authorName" required maxLength={200} defaultValue={value.authorName} /></label>
    <label className="block text-sm font-medium">Git author email<input key={value.authorEmail} className={control} name="authorEmail" type="email" required maxLength={254} defaultValue={value.authorEmail} /></label>
    <label className="flex items-center gap-3 text-sm"><input key={String(value.sound)} name="sound" type="checkbox" defaultChecked={value.sound} />Play a sound when a chat finishes work</label>
  </fieldset>;
}
