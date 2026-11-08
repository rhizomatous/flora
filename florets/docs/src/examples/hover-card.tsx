import { Button, HoverCard, HoverCardContent, HoverCardTrigger } from "@flora/florets";

export function Example() {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link">About Flora</Button>
      </HoverCardTrigger>
      <HoverCardContent>
        <p className="font-medium">Flora</p>
        <p className="mt-2 text-sm text-muted-foreground">
          A coding agent that works in your project’s workspace.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
