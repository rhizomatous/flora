// oxlint-disable jsx-a11y/anchor-ambiguous-text -- The sample link text is preserved from the upstream examples.
// oxlint-disable jsx-a11y/anchor-is-valid -- Placeholder links demonstrate component styling without navigating away.
import { ArrowRightIcon } from "lucide-react";

import { Badge } from "@flora/florets/components/badge";
import { Button } from "@flora/florets/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@flora/florets/components/empty";
import { Field, FieldLabel } from "@flora/florets/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@flora/florets/components/input-group";
import { Spinner } from "@flora/florets/components/spinner";

// Adapted from https://ui.shadcn.com/r/styles/radix-nova/spinner-example.json
import { Example, ExampleWrapper } from "../example";

export function Preview() {
  return (
    <ExampleWrapper>
      <SpinnerBasic />
      <SpinnerInButtons />
      <SpinnerInBadges />
      <SpinnerInInputGroup />
      <SpinnerInEmpty />
    </ExampleWrapper>
  );
}

function SpinnerBasic() {
  return (
    <Example title="Basic">
      <div className="flex items-center gap-6">
        <Spinner />
        <Spinner className="size-6" />
      </div>
    </Example>
  );
}

function SpinnerInButtons() {
  return (
    <Example title="In Buttons">
      <div className="flex flex-wrap items-center gap-4">
        <Button>
          <Spinner data-icon="inline-start" /> Submit
        </Button>
        <Button disabled>
          <Spinner data-icon="inline-start" /> Disabled
        </Button>
        <Button variant="outline" disabled>
          <Spinner data-icon="inline-start" /> Outline
        </Button>
        <Button variant="outline" size="icon" disabled>
          <Spinner data-icon="inline-start" />
          <span className="sr-only">Loading...</span>
        </Button>
      </div>
    </Example>
  );
}

function SpinnerInBadges() {
  return (
    <Example title="In Badges" className="items-center justify-center">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Badge>
          <Spinner data-icon="inline-start" />
          Badge
        </Badge>
        <Badge variant="secondary">
          <Spinner data-icon="inline-start" />
          Badge
        </Badge>
        <Badge variant="destructive">
          <Spinner data-icon="inline-start" />
          Badge
        </Badge>
        <Badge variant="outline">
          <Spinner data-icon="inline-start" />
          Badge
        </Badge>
      </div>
    </Example>
  );
}

function SpinnerInInputGroup() {
  return (
    <Example title="In Input Group">
      <Field>
        <FieldLabel htmlFor="input-group-spinner">Input Group</FieldLabel>
        <InputGroup>
          <InputGroupInput id="input-group-spinner" />
          <InputGroupAddon>
            <Spinner />
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </Example>
  );
}

function SpinnerInEmpty() {
  return (
    <Example title="In Empty State" containerClassName="lg:col-span-full">
      <Empty className="min-h-[300px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>
            You haven&apos;t created any projects yet. Get started by creating your first project.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button role="link" render={<a href="#">Create project</a>} nativeButton={false} />
            <Button variant="outline">Import project</Button>
          </div>
          <Button
            role="link"
            variant="link"
            render={
              <a href="#">
                Learn more <ArrowRightIcon />
              </a>
            }
            nativeButton={false}
            className="text-muted-foreground"
          />
        </EmptyContent>
      </Empty>
    </Example>
  );
}
