import { ArrowRightIcon, ArrowUpRightIcon, BadgeCheck } from "lucide-react";

import { Badge } from "@flora/florets/components/badge";
import { Spinner } from "@flora/florets/components/spinner";

// oxlint-disable jsx-a11y/anchor-ambiguous-text -- The sample link text is preserved from the upstream examples.
// oxlint-disable jsx-a11y/anchor-is-valid -- Placeholder links demonstrate component styling without navigating away.
// Adapted from https://ui.shadcn.com/r/styles/radix-rhea/badge-example.json
import { Example, ExampleWrapper } from "../example";

export function Preview() {
  return (
    <ExampleWrapper className="lg:grid-cols-1">
      <BadgeVariants />
      <BadgeWithIconLeft />
      <BadgeWithIconRight />
      <BadgeWithSpinner />
      <BadgeAsLink />
      <BadgeLongText />
      <BadgeCustomColors />
    </ExampleWrapper>
  );
}

function BadgeVariants() {
  return (
    <Example title="Variants">
      <div className="style-sera:gap-6 flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="ghost">Ghost</Badge>
        <Badge variant="link">Link</Badge>
      </div>
    </Example>
  );
}

function BadgeWithIconLeft() {
  return (
    <Example title="Icon Left" className="max-w-fit">
      <div className="style-sera:gap-6 flex flex-wrap gap-2">
        <Badge>
          <BadgeCheck data-icon="inline-start" />
          Default
        </Badge>
        <Badge variant="secondary">
          <BadgeCheck data-icon="inline-start" />
          Secondary
        </Badge>
        <Badge variant="destructive">
          <BadgeCheck data-icon="inline-start" />
          Destructive
        </Badge>
        <Badge variant="outline">
          <BadgeCheck data-icon="inline-start" />
          Outline
        </Badge>
        <Badge variant="ghost">
          <BadgeCheck data-icon="inline-start" />
          Ghost
        </Badge>
        <Badge variant="link">
          <BadgeCheck data-icon="inline-start" />
          Link
        </Badge>
      </div>
    </Example>
  );
}

function BadgeWithIconRight() {
  return (
    <Example title="Icon Right" className="max-w-fit">
      <div className="style-sera:gap-6 flex flex-wrap gap-2">
        <Badge>
          Default
          <ArrowRightIcon data-icon="inline-end" />
        </Badge>
        <Badge variant="secondary">
          Secondary
          <ArrowRightIcon data-icon="inline-end" />
        </Badge>
        <Badge variant="destructive">
          Destructive
          <ArrowRightIcon data-icon="inline-end" />
        </Badge>
        <Badge variant="outline">
          Outline
          <ArrowRightIcon data-icon="inline-end" />
        </Badge>
        <Badge variant="ghost">
          Ghost
          <ArrowRightIcon data-icon="inline-end" />
        </Badge>
        <Badge variant="link">
          Link
          <ArrowRightIcon data-icon="inline-end" />
        </Badge>
      </div>
    </Example>
  );
}

function BadgeWithSpinner() {
  return (
    <Example title="With Spinner" className="max-w-fit">
      <div className="style-sera:gap-6 flex flex-wrap gap-2">
        <Badge>
          <Spinner data-icon="inline-start" />
          Default
        </Badge>
        <Badge variant="secondary">
          <Spinner data-icon="inline-start" />
          Secondary
        </Badge>
        <Badge variant="destructive">
          <Spinner data-icon="inline-start" />
          Destructive
        </Badge>
        <Badge variant="outline">
          <Spinner data-icon="inline-start" />
          Outline
        </Badge>
        <Badge variant="ghost">
          <Spinner data-icon="inline-start" />
          Ghost
        </Badge>
        <Badge variant="link">
          <Spinner data-icon="inline-start" />
          Link
        </Badge>
      </div>
    </Example>
  );
}

function BadgeAsLink() {
  return (
    <Example title="asChild">
      <div className="style-sera:gap-6 flex flex-wrap gap-2">
        <Badge asChild>
          <a href="#">
            Link <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </Badge>
        <Badge asChild variant="secondary">
          <a href="#">
            Link <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </Badge>
        <Badge asChild variant="destructive">
          <a href="#">
            Link <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </Badge>
        <Badge asChild variant="outline">
          <a href="#">
            Link <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </Badge>
        <Badge asChild variant="ghost">
          <a href="#">
            Link <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </Badge>
        <Badge asChild variant="link">
          <a href="#">
            Link <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </Badge>
      </div>
    </Example>
  );
}

function BadgeLongText() {
  return (
    <Example title="Long Text">
      <div className="style-sera:gap-6 flex flex-wrap gap-2">
        <Badge variant="secondary">A badge with a lot of text to see how it wraps</Badge>
      </div>
    </Example>
  );
}

function BadgeCustomColors() {
  return (
    <Example title="Custom Colors" className="max-w-fit">
      <div className="style-sera:gap-6 flex flex-wrap gap-2">
        <Badge className="bg-blue-600 text-blue-50 dark:bg-blue-600 dark:text-blue-50">Blue</Badge>
        <Badge className="bg-green-600 text-green-50 dark:bg-green-600 dark:text-green-50">
          Green
        </Badge>
        <Badge className="bg-sky-600 text-sky-50 dark:bg-sky-600 dark:text-sky-50">Sky</Badge>
        <Badge className="bg-purple-600 text-purple-50 dark:bg-purple-600 dark:text-purple-50">
          Purple
        </Badge>
        <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">Blue</Badge>
        <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
          Green
        </Badge>
        <Badge className="bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300">Sky</Badge>
        <Badge className="bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
          Purple
        </Badge>
        <Badge className="bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">Red</Badge>
      </div>
    </Example>
  );
}
