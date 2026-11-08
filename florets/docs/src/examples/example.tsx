import type { ComponentProps } from "react";

import { cn } from "@flora/florets";

import { CodeExample } from "../code-example";
import { useExampleSource } from "../example-source";
import { exampleAnchor, sourceForExample } from "../example-source-utils";

const explanations: Record<string, string> = {
  "Variants & Sizes":
    "Use variant to choose the visual emphasis and size to fit the surrounding controls.",
  Sizes: "Use the size prop to keep related controls consistent.",
  Disabled:
    "Set disabled when an action is unavailable. Explain why near the control when the reason is not obvious.",
  Invalid:
    "Use aria-invalid to mark a field that needs attention, and pair it with an error message.",
  "With Label": "Give the control a visible label so people know what to enter or choose.",
  "With Description":
    "Place supporting instructions next to the control before the user needs them.",
  "Icon Only": "Give icon-only controls an accessible name with aria-label.",
  "With Shortcuts": "Show keyboard shortcuts next to the actions they trigger.",
  "With Destructive Items": "Use destructive styling for actions that remove or discard data.",
};

export function ExampleWrapper({ className, ...props }: ComponentProps<"div">) {
  const source = useExampleSource();
  return (
    <div
      className={
        source === undefined
          ? cn("grid w-full min-w-0 items-start gap-6 p-4 md:grid-cols-2", className)
          : "docs-examples flex w-full min-w-0 flex-col gap-14"
      }
      {...props}
    />
  );
}

export function Example({
  title,
  children,
  className,
  containerClassName,
  ...props
}: ComponentProps<"div"> & { title?: string; containerClassName?: string }) {
  const source = useExampleSource();
  const documented = source !== undefined;
  return (
    <section
      data-slot="example"
      aria-label={title}
      id={documented && title !== undefined ? exampleAnchor(title) : undefined}
      className={cn(
        documented ? "min-w-0 scroll-mt-24" : "min-w-0 rounded-2xl border bg-card",
        containerClassName,
      )}
      {...props}
    >
      {title !== undefined && (
        <h2
          className={
            documented
              ? "mb-5 text-xl font-semibold tracking-tight"
              : "border-b px-5 py-3 text-sm font-medium"
          }
        >
          {documented ? (
            <a
              className="underline-offset-4 hover:underline"
              href={`${location.hash.startsWith("#example-") ? `#components/${location.hash.slice(9)}` : location.hash.split("/").slice(0, 2).join("/")}/${exampleAnchor(title)}`}
            >
              {title}
            </a>
          ) : (
            title
          )}
        </h2>
      )}
      {documented && title !== undefined && explanations[title] !== undefined && (
        <p className="mb-5 text-sm leading-7 text-muted-foreground">{explanations[title]}</p>
      )}
      <div className={documented ? "overflow-hidden rounded-xl border" : undefined}>
        <div
          data-slot="example-content"
          className={cn(
            "flex min-w-0 flex-col items-start gap-6 overflow-x-auto p-5 *:[div:not([class*='w-'])]:w-full",
            documented && "min-h-64 justify-center px-6 py-12 sm:px-10",
            className,
          )}
        >
          {children}
        </div>
        {documented && (
          <div className="border-t">
            <CodeExample
              code={sourceForExample(source, title)}
              title={`${title ?? "Component"} example source`}
              collapsible
            />
          </div>
        )}
      </div>
    </section>
  );
}
