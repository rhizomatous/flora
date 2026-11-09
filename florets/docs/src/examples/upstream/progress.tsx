"use client";

import { FileIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@flora/florets/components/item";
import { Progress, ProgressLabel, ProgressValue } from "@flora/florets/components/progress";
import { Slider } from "@flora/florets/components/slider";

import { Example, ExampleWrapper } from "../example";

export function Preview() {
  return (
    <ExampleWrapper>
      <ProgressValues />
      <ProgressWithLabel />
      <ProgressControlled />
      <FileUploadList />
    </ExampleWrapper>
  );
}

function ProgressValues() {
  return (
    <Example title="Progress Bar">
      <div className="flex w-full flex-col gap-4">
        <Progress value={0} />
        <Progress value={25} className="w-full" />
        <Progress value={50} />
        <Progress value={75} />
        <Progress value={100} />
      </div>
    </Example>
  );
}

function ProgressWithLabel() {
  return (
    <Example title="With Label">
      <Progress value={56}>
        <ProgressLabel>Upload progress</ProgressLabel>
        <ProgressValue />
      </Progress>
    </Example>
  );
}

function ProgressControlled() {
  const [value, setValue] = useState(50);

  return (
    <Example title="Controlled">
      <div className="flex w-full flex-col gap-4">
        <Progress value={value} className="w-full" />
        <Slider
          value={value}
          onValueChange={(nextValue) => {
            setValue(typeof nextValue === "number" ? nextValue : (nextValue[0] ?? 0));
          }}
          min={0}
          max={100}
          step={1}
        />
      </div>
    </Example>
  );
}

function FileUploadList() {
  const files = useMemo(
    () => [
      {
        id: "1",
        name: "document.pdf",
        progress: 45,
        timeRemaining: "2m 30s",
      },
      {
        id: "2",
        name: "presentation.pptx",
        progress: 78,
        timeRemaining: "45s",
      },
      {
        id: "3",
        name: "spreadsheet.xlsx",
        progress: 12,
        timeRemaining: "5m 12s",
      },
      {
        id: "4",
        name: "image.jpg",
        progress: 100,
        timeRemaining: "Complete",
      },
    ],
    [],
  );

  return (
    <Example title="File Upload List">
      <ItemGroup>
        {files.map((file) => (
          <Item key={file.id} size="xs" className="px-0">
            <ItemMedia variant="icon">
              <FileIcon className="size-5" />
            </ItemMedia>
            <ItemContent className="inline-block truncate">
              <ItemTitle className="inline">{file.name}</ItemTitle>
            </ItemContent>
            <ItemContent>
              <Progress value={file.progress} className="w-32" />
            </ItemContent>
            <ItemActions className="w-16 justify-end">
              <span className="text-sm text-muted-foreground">{file.timeRemaining}</span>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </Example>
  );
}
