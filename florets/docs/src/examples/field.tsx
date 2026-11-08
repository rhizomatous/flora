import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, Input } from "@flora/florets";

export function Example() {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="example-field-name">Project name</FieldLabel>
        <Input id="example-field-name" placeholder="My project" />
        <FieldDescription>Use a short, memorable name.</FieldDescription>
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="example-field-repo">Repository</FieldLabel>
        <Input
          id="example-field-repo"
          aria-invalid
          aria-describedby="example-field-error"
          defaultValue="not a URL"
        />
        <FieldError id="example-field-error">Enter a valid repository URL.</FieldError>
      </Field>
    </FieldGroup>
  );
}
