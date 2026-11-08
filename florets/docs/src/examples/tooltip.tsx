import { Button, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@flora/florets";

export function Example() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover or focus me</Button>
        </TooltipTrigger>
        <TooltipContent>Start a new conversation</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
