import { Input, Label } from "@flora/florets";

export function Example() {
  return (
    <div className="grid w-full gap-2">
      <Label htmlFor="example-label">Display name</Label>
      <Input id="example-label" placeholder="Flora" />
    </div>
  );
}
