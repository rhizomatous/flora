import { Input } from "@flora/florets";

export function Example() {
  return (
    <div className="grid w-full gap-3">
      <Input aria-label="Example email" type="email" placeholder="you@example.com" />
      <Input aria-label="Disabled input" disabled placeholder="Disabled" />
    </div>
  );
}
