import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@flora/florets";

export function Example() {
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>hello.ts</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value='const greeting = "Hello, Flora";' />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        <CodeBlockLine>const greeting = &quot;Hello, Flora&quot;;</CodeBlockLine>
        <CodeBlockLine>console.log(greeting);</CodeBlockLine>
      </CodeBlockContent>
    </CodeBlock>
  );
}
