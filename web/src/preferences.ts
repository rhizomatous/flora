import type { Preferences } from "./settings-schemas";
import { text } from "./ui";

type NumericPreference = Exclude<keyof Preferences, "authorName" | "authorEmail" | "sound">;

export const preferenceFields: {
  name: NumericPreference;
  label: string;
  min: number;
  max: number;
  step?: number;
}[] = [
  { name: "maxRunning", label: "Maximum running containers", min: 1, max: 1000 },
  { name: "cpus", label: "CPUs per chat", min: 0.1, max: 256, step: 0.1 },
  {
    name: "memoryBytes",
    label: "Memory per chat (bytes)",
    min: 67_108_864,
    max: 1_099_511_627_776,
  },
  { name: "pidsLimit", label: "Processes per chat", min: 16, max: 65_536 },
  { name: "setupSeconds", label: "Setup timeout (seconds)", min: 1, max: 86_400 },
  { name: "activitySeconds", label: "Continuous-activity timeout (seconds)", min: 1, max: 604_800 },
  { name: "inlineDiffBytes", label: "Inline diff threshold (bytes)", min: 1024, max: 16_777_216 },
  { name: "messageBytes", label: "Maximum message text (UTF-8 bytes)", min: 1024, max: 4_194_304 },
  {
    name: "sessionSeconds",
    label: "Absolute browser session lifetime (seconds)",
    min: 300,
    max: 31_536_000,
  },
];

/** Reads the PreferenceFields inputs from a submitted settings form. */
export function readPreferences(form: FormData): Preferences {
  const number = (name: NumericPreference) => Number(text(form, name));
  return {
    cpus: number("cpus"),
    memoryBytes: number("memoryBytes"),
    pidsLimit: number("pidsLimit"),
    setupSeconds: number("setupSeconds"),
    maxRunning: number("maxRunning"),
    activitySeconds: number("activitySeconds"),
    inlineDiffBytes: number("inlineDiffBytes"),
    messageBytes: number("messageBytes"),
    sessionSeconds: number("sessionSeconds"),
    authorName: text(form, "authorName"),
    authorEmail: text(form, "authorEmail"),
    sound: form.has("sound"),
  };
}
