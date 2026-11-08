import { useEffect, useId, useState, type ReactNode } from "react";

import {
  Button,
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@flora/florets";

import { highlightCode } from "../../src/lib/highlighter";

const highlighted = new Map<string, Promise<ReactNode[][] | null>>();

function highlight(code: string) {
  let pending = highlighted.get(code);
  if (pending === undefined) {
    pending = highlightCode(code, "tsx");
    highlighted.set(code, pending);
  }
  return pending;
}

export function CodeExample({
  code,
  title = "Code",
  collapsible = false,
}: {
  code: string;
  title?: string;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  const [tokens, setTokens] = useState<{ code: string; lines: ReactNode[][] | null }>();
  const id = useId();

  useEffect(() => {
    let active = true;
    async function loadTokens() {
      try {
        const lines = await highlight(code);
        if (active) setTokens({ code, lines });
      } catch {
        // Plain text remains available if the syntax highlighter cannot load.
      }
    }
    void loadTokens();
    return () => {
      active = false;
    };
  }, [code]);

  return (
    <CodeBlock className="docs-code rounded-none bg-muted/40 ring-0" size="sm">
      <CodeBlockHeader className="px-5 pt-3">
        <CodeBlockTitle className="text-muted-foreground">{title}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} aria-label={`Copy ${title.toLowerCase()}`} />
          {collapsible && expanded && (
            <Button
              variant="ghost"
              size="xs"
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => {
                setExpanded(false);
              }}
            >
              Collapse
            </Button>
          )}
        </CodeBlockActions>
      </CodeBlockHeader>
      <div
        id={id}
        className={expanded ? "max-h-72 overflow-auto" : "relative h-24 overflow-hidden"}
      >
        <CodeBlockContent
          lineNumbers
          aria-label={title}
          aria-hidden={!expanded}
          tabIndex={expanded ? 0 : -1}
          className="px-5 text-xs leading-7"
        >
          {tokens?.code === code && tokens.lines !== null
            ? tokens.lines.map((line, lineIndex) => (
                // oxlint-disable-next-line react/no-array-index-key -- Token lines retain their positions in the source.
                <CodeBlockLine key={lineIndex}>{line}</CodeBlockLine>
              ))
            : code}
        </CodeBlockContent>
        {!expanded && (
          <div className="absolute inset-0 flex items-center justify-center bg-linear-to-b from-transparent to-background/95">
            <Button
              variant="outline"
              size="sm"
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => {
                setExpanded(true);
              }}
            >
              View code
            </Button>
          </div>
        )}
      </div>
    </CodeBlock>
  );
}
