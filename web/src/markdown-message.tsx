import type { ComponentProps } from "react";

import { MessageResponse } from "@flora/florets/ai";

const components: NonNullable<ComponentProps<typeof MessageResponse>["components"]> = {
  h1: ({ children }) => <h2>{children}</h2>,
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

/** Renders agent prose as Markdown; raw HTML stays inert and URLs use the renderer's safe defaults. */
export function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className="message-prose">
      <MessageResponse components={components}>{children}</MessageResponse>
    </div>
  );
}
