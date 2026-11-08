import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@flora/florets";

export function Example() {
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger asChild>
        <Button variant="outline">Show changed files</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 rounded-xl border p-3 text-sm">
        src/main.tsx
        <br />
        src/styles.css
      </CollapsibleContent>
    </Collapsible>
  );
}
