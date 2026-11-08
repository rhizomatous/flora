import { Label, Switch } from "@flora/florets";

export function Example() {
  return (
    <div className="flex items-center gap-2">
      <Switch id="example-switch" />
      <Label htmlFor="example-switch">Enable notifications</Label>
    </div>
  );
}
