import { CheckIcon } from "lucide-react";

import {
  TraceIcon,
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "@flora/florets";

export function Example() {
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <CheckIcon />
        </TraceIcon>
        <TraceTitle>Read project files</TraceTitle>
        <TraceDescription>2s</TraceDescription>
      </TraceLine>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceTitle>Check the build</TraceTitle>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          The build completed successfully. No errors were found.
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
