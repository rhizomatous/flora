import { useId } from "react";

import {
  EditableText,
  FieldLabel,
  Heading,
  MadlibSelect,
  NativeSelect,
  Section,
  SectionHeader,
  SectionStack,
  SettingsGroup,
  SettingsRow,
  Switch,
  TextareaPanel,
  TextareaPanelInput,
  TextareaPanelFooter,
} from "@flora/florets";

import { Example, ExampleWrapper } from "../example";

function SettingsExample() {
  const id = useId();
  return (
    <SectionStack className="w-full">
      <Section className="gap-2">
        <EditableText label="Name" variant="title" defaultValue="Weekly review" />
        <EditableText
          label="Description"
          multiline
          className="text-sm"
          placeholder="Add a description"
        />
      </Section>
      <Section>
        <SectionHeader inset>
          <Heading level={3}>Delivery</Heading>
          <p className="text-sm text-muted-foreground">Choose where updates arrive</p>
        </SectionHeader>
        <SettingsGroup>
          <SettingsRow
            label="Project"
            htmlFor={`${id}-project`}
            descriptionId={`${id}-project-help`}
            description="The project this review works in"
          >
            <NativeSelect
              width="content"
              id={`${id}-project`}
              aria-describedby={`${id}-project-help`}
              defaultValue="garden"
            >
              <option value="garden">Garden</option>
              <option value="long">Customer experience and accessibility</option>
            </NativeSelect>
          </SettingsRow>
          <SettingsRow
            label="Notify when a review needs attention"
            htmlFor={`${id}-notify`}
            description="Send a notification when your input is needed"
            descriptionId={`${id}-notify-help`}
          >
            <Switch id={`${id}-notify`} aria-describedby={`${id}-notify-help`} defaultChecked />
          </SettingsRow>
          <SettingsRow label="Frequency" htmlFor={`${id}-frequency`}>
            <MadlibSelect id={`${id}-frequency`} defaultValue="weekly">
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </MadlibSelect>
          </SettingsRow>
        </SettingsGroup>
      </Section>
      <Section>
        <SectionHeader inset>
          <FieldLabel htmlFor={`${id}-instructions`}>Instructions</FieldLabel>
          <p id={`${id}-instructions-help`} className="text-sm text-muted-foreground">
            What to include in each review
          </p>
        </SectionHeader>
        <TextareaPanel>
          <TextareaPanelInput
            id={`${id}-instructions`}
            aria-describedby={`${id}-instructions-help`}
            defaultValue="Summarize recent changes and highlight anything that needs attention."
          />
          <TextareaPanelFooter>
            <MadlibSelect aria-label="Output format" defaultValue="summary">
              <option value="summary">Short summary</option>
              <option value="detailed">Detailed report</option>
            </MadlibSelect>
          </TextareaPanelFooter>
        </TextareaPanel>
      </Section>
    </SectionStack>
  );
}

export function Preview() {
  return (
    <ExampleWrapper>
      <Example title="Settings and detail composition">
        <SettingsExample />
      </Example>
      <Example title="Narrow layout with long labels">
        <div className="w-full max-w-80">
          <SettingsExample />
        </div>
      </Example>
    </ExampleWrapper>
  );
}
