import {
  Card,
  EditableText,
  FieldLabel,
  Heading,
  Section,
  SectionHeader,
  SectionStack,
  Text,
  Textarea,
} from "@flora/florets";

import { Example, ExampleWrapper } from "../example";

export function Preview() {
  return (
    <ExampleWrapper>
      <Example title="Detail sections">
        <SectionStack className="w-full">
          <Section>
            <div className="space-y-1">
              <EditableText label="Title" variant="title" defaultValue="Weekly review" />
              <EditableText
                label="Description"
                multiline
                defaultValue="Summarize recent changes."
              />
            </div>
            <Text className="mx-px px-4" tone="muted">
              Active
            </Text>
          </Section>
          <Section>
            <SectionHeader className="mx-px px-4">
              <FieldLabel htmlFor="section-instructions">Instructions</FieldLabel>
              <Text tone="muted">Describe what the automation should do.</Text>
            </SectionHeader>
            <Textarea
              id="section-instructions"
              defaultValue="Review changes and summarize the results."
            />
          </Section>
          <Section>
            <SectionHeader className="mx-px px-4">
              <Heading level={2}>Run history</Heading>
            </SectionHeader>
            <Card className="px-4">No runs yet.</Card>
          </Section>
          <Text tone="muted">
            SectionStack separates sections by 40px on small screens and 48px on wider screens.
            Section separates its heading and content by 16px. SectionHeader keeps a heading and
            description 8px apart.
          </Text>
        </SectionStack>
      </Example>
    </ExampleWrapper>
  );
}
