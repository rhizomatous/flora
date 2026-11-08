import type { ReactNode } from "react";

import {
  ButtonLink,
  FlowerMark,
  Heading,
  Link,
  LoadingStatus,
  Text,
  Wordmark,
} from "@flora/florets";

import { CodeExample } from "./code-example";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-5">
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Demo({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-56 flex-wrap items-center justify-center gap-8 rounded-xl border p-8">
      {children}
    </div>
  );
}

const colorClasses: Record<string, string> = {
  Primary: "bg-primary text-primary-foreground",
  Muted: "bg-muted text-muted-foreground",
  Background: "bg-background text-foreground",
};

export function FoundationPage({ id }: { id: string }) {
  return (
    <div className="space-y-12 text-sm leading-7">
      {id === "introduction" && (
        <>
          <Section id="about" title="About Florets">
            <p>
              Florets is the shared design system used by Flora. It brings together general-purpose
              interface components, conversation patterns, and Flora’s typography and identity.
            </p>
          </Section>
          <Section id="getting-started" title="Getting started">
            <p>
              Start with the workspace setup, then browse components for interactive examples and
              their source code.
            </p>
            <div className="flex flex-wrap items-center gap-6">
              <ButtonLink href="#installation">Set up Florets</ButtonLink>
              <Link href="#components">Browse components</Link>
            </div>
          </Section>
          <Section id="imports" title="Two component collections">
            <p>
              Import interface components from <code>@flora/florets</code>. The AI Elements pages
              compose these building blocks into conversation patterns. The{" "}
              <code>@flora/florets/ai</code> entry point also exports Markdown rendering and
              conversation primitives. Both entry points use the same shared stylesheet.
            </p>
            <CodeExample
              code={
                'import { Button, Heading, Text } from "@flora/florets";\nimport { Markdown } from "@flora/florets/ai";\nimport "@flora/florets/styles.css";'
              }
            />
          </Section>
        </>
      )}
      {id === "installation" && (
        <>
          <Section id="workspace" title="Workspace package">
            <p>
              Florets is a private package in this repository. It is linked by npm workspaces and is
              not published to the public npm registry. Run the workspace install from the
              repository root.
            </p>
            <CodeExample code="npm install" />
            <p>Applications in this workspace declare the package as a dependency:</p>
            <CodeExample code={'{\n  "dependencies": {\n    "@flora/florets": "0.0.0"\n  }\n}'} />
          </Section>
          <Section id="styles" title="Load the styles">
            <p>
              Import the stylesheet once in your application’s entry point. It includes Tailwind
              CSS, the shared tokens, and the Geist fonts. The existing Vite applications process it
              with the Tailwind Vite plugin.
            </p>
            <CodeExample code='import "@flora/florets/styles.css";' />
          </Section>
          <Section id="first-component" title="Use a component">
            <p>
              Import components from the package, or use a component subpath when you want a
              narrower import.
            </p>
            <CodeExample
              code={
                'import { Button } from "@flora/florets";\n// Also available from "@flora/florets/components/button".\n\nexport function SaveButton() {\n  return <Button type="submit">Save changes</Button>;\n}'
              }
            />
          </Section>
          <Section id="providers" title="Providers">
            <p>
              Components that share state need their matching provider. Wrap tooltip content in{" "}
              <code>TooltipProvider</code>. Mount one <code>Toaster</code> to display Sonner
              notifications. Individual examples show the composition required by each component.
            </p>
            <CodeExample
              code={
                'import { Toaster, TooltipProvider } from "@flora/florets";\n\n<TooltipProvider>\n  <App />\n  <Toaster theme="dark" />\n</TooltipProvider>'
              }
            />
          </Section>
        </>
      )}
      {id === "theming" && (
        <>
          <Section id="color-mode" title="Light and dark mode">
            <p>
              The stylesheet defines light tokens on the root and dark tokens under the{" "}
              <code>dark</code> class. Flora defaults to dark mode. Add the class to the document
              element before rendering to start in dark mode.
            </p>
            <CodeExample
              code={'<html lang="en" class="dark">\n  <!-- Application content -->\n</html>'}
            />
            <p>
              Change the class to switch modes. The theme button in these docs updates the examples
              as well as the page.
            </p>
            <CodeExample code='document.documentElement.classList.toggle("dark", useDarkTheme);' />
          </Section>
          <Section id="semantic-colors" title="Semantic colors">
            <p>
              Use semantic utilities so content stays readable in both themes. Pair backgrounds with
              the corresponding foreground token, such as <code>bg-primary</code> and{" "}
              <code>text-primary-foreground</code>.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {["Background", "Muted", "Primary"].map((name) => (
                <div key={name} className={`rounded-xl border p-6 ${colorClasses[name]}`}>
                  {name}
                </div>
              ))}
            </div>
            <CodeExample
              code={
                '<div className="rounded-lg border border-border bg-muted p-4 text-muted-foreground">\n  Supporting information\n</div>'
              }
            />
          </Section>
          <Section id="custom-tokens" title="Customize tokens">
            <p>
              Override CSS variables after importing the shared stylesheet. Set values for both
              color modes when changing a semantic color. Components also accept{" "}
              <code>className</code> for local layout and style adjustments.
            </p>
            <CodeExample
              code={
                ":root {\n  --radius: 0.625rem;\n  --primary: oklch(0.3 0.05 150);\n  --primary-foreground: oklch(0.98 0 0);\n}\n\n.dark {\n  --primary: oklch(0.85 0.05 150);\n  --primary-foreground: oklch(0.15 0 0);\n}"
              }
            />
          </Section>
        </>
      )}
      {id === "typography" && (
        <>
          <Section id="headings" title="Headings">
            <p>
              Choose the heading level for the document structure. Each level has a default size,
              weight, and line height. Layout controls the spacing around headings.
            </p>
            <Demo>
              <div className="w-full space-y-4">
                {([1, 2, 3, 4, 5, 6] as const).map((level) => (
                  <div key={level} className="flex items-baseline gap-6">
                    <Text as="span" size="xs" tone="muted" className="w-6 shrink-0 font-mono">
                      h{level}
                    </Text>
                    <Heading level={level}>Build something useful</Heading>
                  </div>
                ))}
              </div>
            </Demo>
            <CodeExample
              code={
                'import { Heading } from "@flora/florets";\n\n<Heading level={1}>Installation settings</Heading>\n<Heading level={2}>Model provider</Heading>\n<Heading level={3}>Credentials</Heading>'
              }
            />
          </Section>
          <Section id="text" title="Text">
            <p>
              Text renders a paragraph by default. Use <code>as=&quot;span&quot;</code> for inline
              content. Choose from three sizes and default, muted, or inherited color.
            </p>
            <Demo>
              <div className="w-full space-y-4">
                <Text size="md">Describe a task. Come back to review the work.</Text>
                <Text>Describe a task. Come back to review the work.</Text>
                <Text size="xs">Describe a task. Come back to review the work.</Text>
                <div className="flex flex-wrap gap-6 border-t pt-4">
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
            </Demo>
            <CodeExample
              code={
                'import { Text } from "@flora/florets";\n\n<Text size="md">Body text</Text>\n<Text tone="muted">Supporting information</Text>\n<Text as="span" size="xs">Last updated today</Text>'
              }
            />
          </Section>
        </>
      )}
      {id === "links" && (
        <Section id="navigation" title="Text and button links">
          <p>
            Both components render anchors. Use <code>Link</code> for an inline destination and{" "}
            <code>ButtonLink</code> when navigation is the primary action. Use a regular Button for
            actions that do not navigate.
          </p>
          <Demo>
            <Link href="#components">Component catalog</Link>
            <ButtonLink href="#components">Browse components</ButtonLink>
          </Demo>
          <CodeExample
            code={
              'import { Link, ButtonLink } from "@flora/florets";\n\n<Link href="/projects">Projects</Link>\n<ButtonLink href="/projects/new">Create a project</ButtonLink>'
            }
          />
        </Section>
      )}
      {id === "feedback" && (
        <Section id="loading-status" title="Loading status">
          <p>
            LoadingStatus renders muted text with <code>role=&quot;status&quot;</code>, allowing
            assistive technology to announce updates. Describe what is loading so the message is
            useful without a spinner.
          </p>
          <Demo>
            <LoadingStatus>Loading projects…</LoadingStatus>
          </Demo>
          <CodeExample
            code={
              'import { LoadingStatus } from "@flora/florets";\n\n<LoadingStatus>Loading projects…</LoadingStatus>'
            }
          />
        </Section>
      )}
      {id === "identity" && (
        <Section id="marks" title="Flower mark and wordmark">
          <p>
            Use FlowerMark for Flora’s five-petal sticker SVG instead of a Unicode flower. Keep its
            black-and-white colors and white rim on both light and dark backgrounds. It is
            decorative and hidden from assistive technology. Wordmark combines it with the Flora
            name. Give any icon-only control its own accessible name.
          </p>
          <Demo>
            <FlowerMark className="text-4xl" />
            <Wordmark />
          </Demo>
          <CodeExample
            code={
              'import { FlowerMark, Wordmark } from "@flora/florets";\n\n<FlowerMark className="text-4xl" />\n<Wordmark />'
            }
          />
        </Section>
      )}
    </div>
  );
}
