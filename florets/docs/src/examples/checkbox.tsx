import { Checkbox, Label } from "@flora/florets";

export function Example() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="example-checkbox" defaultChecked />
      <Label htmlFor="example-checkbox">Send completion notifications</Label>
    </div>
  );
}
