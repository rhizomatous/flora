import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@flora/florets";

export function Example() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Set dimensions</Button>
      </PopoverTrigger>
      <PopoverContent>
        <Field>
          <FieldLabel htmlFor="example-width">Width</FieldLabel>
          <Input id="example-width" defaultValue="320" type="number" />
          <FieldDescription>Width in pixels.</FieldDescription>
        </Field>
      </PopoverContent>
    </Popover>
  );
}
