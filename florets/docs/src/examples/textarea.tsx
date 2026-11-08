import { Textarea } from "@flora/florets";

export function Example() {
  return (
    <Textarea
      aria-label="Task description"
      placeholder="Describe what you would like to build…"
      className="min-h-28"
    />
  );
}
