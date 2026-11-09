// oxlint-disable jsx-a11y/anchor-ambiguous-text -- The sample link text is preserved from the upstream examples.
// oxlint-disable jsx-a11y/anchor-is-valid -- Placeholder links demonstrate component styling without navigating away.
import { ArrowUpRightIcon, CircleDashedIcon, FolderIcon, PlusIcon } from "lucide-react";

import { Button } from "@flora/florets/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@flora/florets/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@flora/florets/components/input-group";
import { Kbd } from "@flora/florets/components/kbd";

// Adapted from https://ui.shadcn.com/r/styles/radix-nova/empty-example.json
import { Example, ExampleWrapper } from "../example";

export function Preview() {
  return (
    <ExampleWrapper className="grid-cols-1!">
      <EmptyBasic />
      <EmptyWithMutedBackground />
      <EmptyWithBorder />
      <EmptyWithIcon />
      <EmptyWithMutedBackgroundAlt />
      <EmptyInCard />
    </ExampleWrapper>
  );
}

function EmptyBasic() {
  return (
    <Example title="Basic">
      <Empty>
        <EmptyHeader>
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
                Learn more <ArrowUpRightIcon />
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

function EmptyWithMutedBackground() {
  return (
    <Example title="With Muted Background">
      <Empty className="bg-muted">
        <EmptyHeader>
          <EmptyTitle>No results found</EmptyTitle>
          <EmptyDescription>
            No results found for your search. Try adjusting your search terms.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button>Try again</Button>
          <Button
            role="link"
            variant="link"
            render={
              <a href="#">
                Learn more <ArrowUpRightIcon />
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

function EmptyWithBorder() {
  return (
    <Example title="With Border">
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>404 - Not Found</EmptyTitle>
          <EmptyDescription>
            The page you&apos;re looking for doesn&apos;t exist. Try searching for what you need
            below.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <InputGroup className="w-3/4">
            <InputGroupInput placeholder="Try searching for pages..." />
            <InputGroupAddon>
              <CircleDashedIcon />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <Kbd>/</Kbd>
            </InputGroupAddon>
          </InputGroup>
          <EmptyDescription>
            Need help? <a href="#">Contact support</a>
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    </Example>
  );
}

function EmptyWithIcon() {
  return (
    <Example title="With Icon">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing to see here</EmptyTitle>
          <EmptyDescription>
            No posts have been created yet. Get started by <a href="#">creating your first post</a>.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline">
            <PlusIcon data-icon="inline-start" />
            New Post
          </Button>
        </EmptyContent>
      </Empty>
    </Example>
  );
}

function EmptyWithMutedBackgroundAlt() {
  return (
    <Example title="With Muted Background Alt">
      <Empty className="bg-muted/50">
        <EmptyHeader>
          <EmptyTitle>404 - Not Found</EmptyTitle>
          <EmptyDescription>
            The page you&apos;re looking for doesn&apos;t exist. Try searching for what you need
            below.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <InputGroup className="w-3/4">
            <InputGroupInput placeholder="Try searching for pages..." />
            <InputGroupAddon>
              <CircleDashedIcon />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <Kbd>/</Kbd>
            </InputGroupAddon>
          </InputGroup>
          <EmptyDescription>
            Need help? <a href="#">Contact support</a>
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    </Example>
  );
}

function EmptyInCard() {
  return (
    <Example title="In Card">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderIcon />
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
                Learn more <ArrowUpRightIcon />
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
