import { Label, RadioGroup, RadioGroupItem } from "@flora/florets";

export function Example() {
  return (
    <RadioGroup defaultValue="quiet" aria-label="Notification preference">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="quiet" id="example-radio-quiet" />
        <Label htmlFor="example-radio-quiet">Quiet</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="all" id="example-radio-all" />
        <Label htmlFor="example-radio-all">All updates</Label>
      </div>
    </RadioGroup>
  );
}
