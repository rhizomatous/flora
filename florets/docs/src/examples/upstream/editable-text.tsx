import { useState } from "react";

import { EditableText } from "@flora/florets/components/editable-text";

import { Example, ExampleWrapper } from "../example";

export function Preview() {
  const [title, setTitle] = useState("Summarize weekly activity");
  const [description, setDescription] = useState("Once a week, summarize commits.");
  return (
    <ExampleWrapper>
      <Example title="Title and description">
        <div className="w-full space-y-1">
          <EditableText
            label="Title"
            variant="title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            required
            maxLength={200}
          />
          <EditableText
            label="Description"
            multiline
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            maxLength={2000}
          />
          <p className="px-3 text-sm text-muted-foreground">
            Changes update the form value. The containing page decides when to save.
          </p>
        </div>
      </Example>
      <Example title="Empty">
        <EditableText label="New title" variant="title" placeholder="Name this automation" />
      </Example>
      <Example title="Disabled">
        <EditableText label="Disabled title" defaultValue="Summarize weekly activity" disabled />
      </Example>
      <Example title="Invalid">
        <EditableText
          label="Required title"
          placeholder="Enter a title"
          aria-invalid="true"
          required
        />
      </Example>
    </ExampleWrapper>
  );
}
