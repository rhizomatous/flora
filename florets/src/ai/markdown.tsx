"use client";

import { useMemo, type ComponentProps } from "react";
import { Streamdown, useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "../components/code-block";
import { useHighlightedCode } from "../hooks/use-highlighted-code";
import { cn } from "../lib/utils";

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  // True while the closing fence has not arrived yet.
  const incomplete = useIsCodeFenceIncomplete();
  const lines = useHighlightedCode(code, language);

  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers>
        {lines.map((line, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- Code lines are identified by position, including duplicate and empty lines.
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function MarkdownCode({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"code"> & ExtraProps) {
  // Streamdown marks fenced code with data-block. Inline code stays inline.
  if (!("data-block" in props)) {
    return (
      <code
        className={cn("rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]", className)}
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <MarkdownCodeBlock
      code={typeof children === "string" ? children : ""}
      language={/language-(\S+)/.exec(className ?? "")?.[1] ?? ""}
    />
  );
}

// Streamdown memoizes on components, so keep the default stable.
const DEFAULT_COMPONENTS = { code: MarkdownCode };

function Markdown({
  className,
  components,
  controls = false,
  ...props
}: ComponentProps<typeof Streamdown>) {
  const renderers = useMemo(() => ({ ...DEFAULT_COMPONENTS, ...components }), [components]);
  return (
    <Streamdown
      data-slot="markdown"
      components={renderers}
      controls={controls}
      className={cn("florets-markdown w-full min-w-0 overflow-hidden", className)}
      {...props}
    />
  );
}

export { Markdown };
