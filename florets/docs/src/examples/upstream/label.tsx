import { Checkbox } from "@flora/florets/components/checkbox";
import { Field } from "@flora/florets/components/field";
import { Input } from "@flora/florets/components/input";
import { Label } from "@flora/florets/components/label";
import { Textarea } from "@flora/florets/components/textarea";

// Adapted from https://ui.shadcn.com/r/styles/radix-nova/label-example.json
import { Example, ExampleWrapper } from "../example";

export function Preview() {
  return (
    <ExampleWrapper>
      <LabelWithCheckbox />
      <LabelWithInput />
      <LabelDisabled />
      <LabelWithTextarea />
    </ExampleWrapper>
  );
}

function LabelWithCheckbox() {
  return (
    <Example title="With Checkbox">
      <Field orientation="horizontal">
        <Checkbox id="label-demo-terms" />
        <Label htmlFor="label-demo-terms">Accept terms and conditions</Label>
      </Field>
    </Example>
  );
}

function LabelWithInput() {
  return (
    <Example title="With Input">
      <Field>
        <Label htmlFor="label-demo-username">Username</Label>
        <Input id="label-demo-username" placeholder="Username" />
      </Field>
    </Example>
  );
}

function LabelDisabled() {
  return (
    <Example title="Disabled">
      <Field data-disabled>
        <Label htmlFor="label-demo-disabled">Disabled</Label>
        <Input id="label-demo-disabled" placeholder="Disabled" disabled />
      </Field>
    </Example>
  );
}

function LabelWithTextarea() {
  return (
    <Example title="With Textarea">
      <Field>
        <Label htmlFor="label-demo-message">Message</Label>
        <Textarea id="label-demo-message" placeholder="Message" />
      </Field>
    </Example>
  );
}
