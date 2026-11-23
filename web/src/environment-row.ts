import type { EnvironmentChange } from "./environment-import";

export type EnvironmentRow = EnvironmentChange & {
  key: string;
  saved: boolean;
  keepable?: boolean | undefined;
};
export function blankVariable(): EnvironmentRow {
  return {
    key: crypto.randomUUID(),
    name: "",
    value: "",
    secret: true,
    action: "replace",
    description: "",
    saved: false,
  };
}
