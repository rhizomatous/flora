import { useState, type ReactNode } from "react";

import {
  Alert,
  Button,
  ButtonLink,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FlowerMark,
  Heading,
  Input,
  Link,
  LoadingStatus,
  NativeSelect,
  Text,
  Textarea,
  Wordmark,
} from "@flora/florets";

import { StippleExample } from "./stipple-example";

const sections = [
  { id: "backgrounds", label: "Backgrounds" },
  { id: "typography", label: "Typography" },
  { id: "buttons", label: "Buttons & links" },
  { id: "forms", label: "Form controls" },
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
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="space-y-6">
      <div>
        <Heading level={2} id={`${id}-heading`}>
          {title}
        </Heading>
        <Text tone="muted" className="mt-2 max-w-2xl">
          {description}
        </Text>
      </div>
      {children}
    </section>
  );
}

function FormExample() {
  const [saved, setSaved] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const name = fields.get("name");
        setSaved(
          typeof name === "string"
            ? `Preview saved for ${name}. No data was sent.`
            : "Preview saved.",
        );
      }}
    >
      <FieldSet>
        <FieldLegend>Project details</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="project-name">Project name</FieldLabel>
            <Input
              id="project-name"
              name="name"
              placeholder="My project"
              required
              aria-describedby="project-help"
            />
            <FieldDescription id="project-help">A name to recognize your project.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="repository-role">Repository role</FieldLabel>
            <NativeSelect id="repository-role" name="role" defaultValue="core">
              <option value="core">Core repository</option>
              <option value="extra">Extra repository</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="project-notes">Notes</FieldLabel>
            <Textarea id="project-notes" name="notes" placeholder="Add a few details…" />
          </Field>
          <Button type="submit">Save preview</Button>
          {saved !== "" && <Alert role="status">{saved}</Alert>}
        </FieldGroup>
      </FieldSet>
    </form>
  );
}

export function Guide() {
  const [dark, setDark] = useState(true);
  const [clicked, setClicked] = useState("");
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
            <Text size="xs" tone="muted" className="mb-4 font-mono">
              @flora/florets
            </Text>
            <Heading level={1} className="text-3xl leading-10">
              Component guide
            </Heading>
            <Text size="md" tone="muted" className="mt-4 max-w-xl">
              Live examples of the building blocks used in Flora. Try the controls, switch themes,
              and open the code to see how they fit together.
            </Text>
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
            <Section
              id="backgrounds"
              title="Backgrounds"
              description="Fixed stippling with slowly drifting illumination. The texture fades toward the center and bottom to keep content quiet."
            >
              <Example
                title="StippleBackground"
                description="Place in a positioned container with content above it. Intensity and density accept 0–1; seed chooses a repeatable pattern. Motion pauses offscreen and in hidden tabs."
                code={
                  '<div className="relative isolate overflow-hidden">\n  <StippleBackground intensity={0.22} density={0.5} motion seed={1} />\n  <div className="relative">Your content</div>\n</div>'
                }
              >
                <StippleExample />
              </Example>
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
            <Section
              id="buttons"
              title="Buttons & links"
              description="Use buttons for actions and links for navigation. Buttons default to type=button; use type=submit in forms."
            >
              <Example
                title="Button"
                description="Four visual variants, with default, small, and inline sizes. Try a button below."
                code={
                  '<Button onClick={save}>Save changes</Button>\n<Button variant="outline">Cancel</Button>\n<Button variant="ghost" size="sm">More options</Button>\n<Button variant="link" size="inline">Learn more</Button>\n<Button disabled>Unavailable</Button>'
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => {
                      setClicked("Primary button clicked.");
                    }}
                  >
                    Primary
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setClicked("Outline button clicked.");
                    }}
                  >
                    Outline
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setClicked("Ghost button clicked.");
                    }}
                  >
                    Ghost
                  </Button>
                  <Button
                    variant="link"
                    size="inline"
                    onClick={() => {
                      setClicked("Link button clicked.");
                    }}
                  >
                    Link
                  </Button>
                  <Button disabled>Disabled</Button>
                </div>
                <Text role="status" size="xs" tone="muted" className="mt-4 min-h-4">
                  {clicked}
                </Text>
              </Example>
              <Example
                title="Link & ButtonLink"
                description="Both render anchors. ButtonLink uses the primary button styling."
                code={
                  '<Link href="#forms">Form controls</Link>\n<ButtonLink href="#forms">Explore forms</ButtonLink>'
                }
              >
                <div className="flex flex-wrap items-center gap-6">
                  <Link href="#forms">Form controls</Link>
                  <ButtonLink href="#forms">Explore forms</ButtonLink>
                </div>
              </Example>
            </Section>
            <Section
              id="forms"
              title="Form controls"
              description="Native controls preserve keyboard interaction and browser validation. Pair labels with IDs, and connect help text with aria-describedby."
            >
              <Example
                title="Fields & controls"
                description="Field, FieldGroup, FieldSet, FieldLegend, FieldLabel, and FieldDescription compose a form. This demo stays in your browser."
                code={
                  '<FieldSet>\n  <FieldLegend>Project details</FieldLegend>\n  <FieldGroup>\n    <Field>\n      <FieldLabel htmlFor="name">Project name</FieldLabel>\n      <Input id="name" required aria-describedby="help" />\n      <FieldDescription id="help">A recognizable name.</FieldDescription>\n    </Field>\n  </FieldGroup>\n</FieldSet>\n\n<NativeSelect defaultValue="core">\n  <option value="core">Core repository</option>\n</NativeSelect>\n<Textarea placeholder="Add a few details…" />'
                }
              >
                <FormExample />
              </Example>
              <Example
                title="Control states"
                description="Disabled controls cannot be edited. Invalid controls need a clear explanation alongside the visual state."
                code={
                  '<Input disabled value="Saved model" />\n<Input aria-invalid="true" aria-describedby="error" />\n<FieldDescription id="error">Enter a project name.</FieldDescription>'
                }
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="disabled-input">Disabled</FieldLabel>
                    <Input id="disabled-input" disabled defaultValue="Saved model" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="invalid-input">Invalid</FieldLabel>
                    <Input
                      id="invalid-input"
                      aria-invalid="true"
                      aria-describedby="invalid-help"
                      placeholder="Project name"
                    />
                    <FieldDescription id="invalid-help">Enter a project name.</FieldDescription>
                  </Field>
                </FieldGroup>
              </Example>
            </Section>
            <Section
              id="feedback"
              title="Feedback"
              description="Use status messages for updates and alerts for errors that need attention."
            >
              <Example
                title="Alert & LoadingStatus"
                description="Alert defaults to role=alert. Set role=status for a non-urgent update."
                code={
                  '<Alert role="status">Settings saved.</Alert>\n<Alert variant="destructive">Could not save. Try again.</Alert>\n<LoadingStatus>Loading projects…</LoadingStatus>'
                }
              >
                <div className="space-y-4">
                  <Alert role="status">Settings saved.</Alert>
                  <Alert variant="destructive">Could not save. Try again.</Alert>
                  <LoadingStatus>Loading projects…</LoadingStatus>
                </div>
              </Example>
            </Section>
            <Section
              id="identity"
              title="Identity"
              description="The flower mark and Flora wordmark share the same quiet, simple treatment as the rest of the interface."
            >
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
          <footer className="mt-14 border-t border-border pt-6">
            <Text size="xs" tone="muted">
              Examples import directly from @flora/florets.
            </Text>
          </footer>
        </main>
      </div>
    </div>
  );
}
