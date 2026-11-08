import { useState, type ReactNode } from "react";

import {
  Button,
  ButtonLink,
  FlowerMark,
  Heading,
  Link,
  LoadingStatus,
  Text,
  Wordmark,
} from "@flora/florets";

import { Catalog } from "./catalog";

const sections = [
  { id: "catalog", label: "Component catalog" },
  { id: "typography", label: "Typography" },
  { id: "links", label: "Links" },
  { id: "feedback", label: "Feedback" },
  { id: "identity", label: "Identity" },
  { id: "colors", label: "Colors" },
];

function Example({
  title,
  description,
  code,
  children,
}: {
  title: string;
  description: string;
  code: string;
  children: ReactNode;
}) {
  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-border">
      <div className="border-b border-border px-5 py-4">
        <Heading level={3}>{title}</Heading>
        <Text tone="muted" className="mt-1">
          {description}
        </Text>
      </div>
      <div className="p-5 sm:p-7">{children}</div>
      <details className="border-t border-border bg-muted/30">
        <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-muted-foreground">
          View code
        </summary>
        <pre
          tabIndex={0}
          aria-label={`${title} example code`}
          className="overflow-auto px-5 pb-5 text-xs leading-6"
        >
          <code>{code}</code>
        </pre>
      </details>
    </article>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="space-y-6">
      <div>
        <Heading level={2} id={`${id}-heading`}>
          {title}
        </Heading>
        {description !== undefined && (
          <Text tone="muted" className="mt-2 max-w-2xl">
            {description}
          </Text>
        )}
      </div>
      {children}
    </section>
  );
}

export function Guide() {
  const [dark, setDark] = useState(true);
  return (
    <div className="min-h-svh">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-20 focus:rounded-md focus:bg-primary focus:p-3 focus:text-primary-foreground"
      >
        Skip to components
      </a>
      <div className="mx-auto grid max-w-7xl lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-border p-6 lg:sticky lg:top-0 lg:h-svh lg:border-r lg:border-b-0 lg:p-8">
          <div className="flex items-center justify-between gap-4 lg:block">
            <a href="#content" className="flex items-center gap-2 text-lg font-semibold">
              <FlowerMark /> Florets
            </a>
            <Text size="xs" tone="muted" className="lg:mt-2">
              Flora’s design system
            </Text>
          </div>
          <nav
            aria-label="Components"
            className="mt-6 flex flex-wrap gap-x-5 gap-y-3 lg:mt-10 lg:flex-col lg:gap-1"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md py-2 text-sm text-muted-foreground hover:text-foreground lg:px-3 lg:hover:bg-muted"
              >
                {section.label}
              </a>
            ))}
          </nav>
          <Button
            variant="outline"
            size="sm"
            className="mt-6 lg:mt-10"
            aria-pressed={!dark}
            onClick={() => {
              document.documentElement.classList.toggle("dark", !dark);
              setDark(!dark);
            }}
          >
            Light theme
          </Button>
        </aside>
        <main id="content" tabIndex={-1} className="min-w-0 px-6 py-10 sm:px-10 lg:px-14 lg:py-14">
          <header className="mb-12 border-b border-border pb-10">
            <Link href="./ai.html">Explore upstream AI Elements</Link>
            <Text size="xs" tone="muted" className="mb-4 font-mono">
              @flora/florets
            </Text>
            <Heading level={1} className="text-3xl leading-10">
              Component guide
            </Heading>
            <pre
              tabIndex={0}
              aria-label="Import Florets"
              className="mt-6 overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs leading-6"
            >
              <code>
                {
                  'import { Button, Heading, Text } from "@flora/florets";\nimport "@flora/florets/styles.css";'
                }
              </code>
            </pre>
          </header>
          <div className="space-y-14">
            <Section id="catalog" title="Component catalog">
              <Catalog dark={dark} />
            </Section>
            <Section
              id="typography"
              title="Typography"
              description="A small type scale, with heading styles tied to semantic level. Layout owns the spacing around text."
            >
              <Example
                title="Heading"
                description="Choose the level for the document structure. Each level has a default size, weight, and line height."
                code={
                  "<Heading level={1}>Installation settings</Heading>\n<Heading level={2}>Model provider</Heading>\n<Heading level={3}>Credentials</Heading>"
                }
              >
                <div className="space-y-4">
                  {([1, 2, 3, 4, 5, 6] as const).map((level) => (
                    <div key={level} className="flex items-baseline gap-6">
                      <Text as="span" size="xs" tone="muted" className="w-6 shrink-0 font-mono">
                        h{level}
                      </Text>
                      <Heading level={level}>Build something useful</Heading>
                    </div>
                  ))}
                </div>
              </Example>
              <Example
                title="Text"
                description="Use paragraphs or inline spans, with three sizes and default, muted, or inherited color."
                code={
                  '<Text size="md">Body text</Text>\n<Text tone="muted">Supporting information</Text>\n<Text as="span" size="xs">Last updated today</Text>'
                }
              >
                <div className="space-y-4">
                  <Text size="md">Describe a task. Come back to review the work.</Text>
                  <Text>Describe a task. Come back to review the work.</Text>
                  <Text size="xs">Describe a task. Come back to review the work.</Text>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4">
                    <Text as="span">Default</Text>
                    <Text as="span" tone="muted">
                      Muted
                    </Text>
                    <div className="text-muted-foreground">
                      <Text as="span" tone="inherit">
                        Inherited
                      </Text>
                    </div>
                  </div>
                </div>
              </Example>
            </Section>
            <Section id="links" title="Links">
              <Example
                title="Link & ButtonLink"
                description="Both render anchors. ButtonLink uses the primary button styling."
                code={
                  '<Link href="#catalog">Component catalog</Link>\n<ButtonLink href="#catalog">Browse components</ButtonLink>'
                }
              >
                <div className="flex flex-wrap items-center gap-6">
                  <Link href="#catalog">Component catalog</Link>
                  <ButtonLink href="#catalog">Browse components</ButtonLink>
                </div>
              </Example>
            </Section>
            <Section id="feedback" title="Feedback">
              <Example
                title="LoadingStatus"
                description="Uses role=status to announce loading progress."
                code="<LoadingStatus>Loading projects…</LoadingStatus>"
              >
                <LoadingStatus>Loading projects…</LoadingStatus>
              </Example>
            </Section>
            <Section id="identity" title="Identity">
              <Example
                title="FlowerMark & Wordmark"
                description="The flower is decorative and hidden from assistive technology. Give icon-only controls their own accessible name."
                code={"<FlowerMark />\n<Wordmark />"}
              >
                <div className="flex flex-wrap items-center gap-10">
                  <FlowerMark className="text-4xl" />
                  <div className="border-l border-border pl-10">
                    <Wordmark />
                  </div>
                </div>
              </Example>
            </Section>
            <Section
              id="colors"
              title="Colors"
              description="Semantic Tailwind tokens keep components consistent across light and dark themes. Switch themes to inspect both palettes."
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { name: "background", color: "bg-background" },
                  { name: "foreground", color: "bg-foreground" },
                  { name: "muted", color: "bg-muted" },
                  { name: "muted-foreground", color: "bg-muted-foreground" },
                  { name: "primary", color: "bg-primary" },
                  { name: "border", color: "bg-border" },
                ].map((token) => (
                  <div
                    key={token.name}
                    className="min-w-0 overflow-hidden rounded-lg border border-border"
                  >
                    <div className={`h-20 border-b border-border ${token.color}`} />
                    <Text size="xs" className="p-3 font-mono break-words">
                      {token.name}
                    </Text>
                  </div>
                ))}
              </div>
              <Text tone="muted">
                Use <code className="font-mono text-xs">cn</code> to merge conditional Tailwind
                classes. Components accept native HTML props, refs, and className overrides.
              </Text>
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}
