// oxlint-disable typescript/strict-void-return -- React ignores return values from these upstream event handlers.
// Adapted from https://ui.shadcn.com/r/styles/radix-rhea/sonner-example.json
"use client";

import { toast } from "sonner";

import { Button } from "@flora/florets/components/button";

import { Example, ExampleWrapper } from "../example";

export function Preview() {
  return (
    <ExampleWrapper>
      <SonnerBasic />
      <SonnerWithDescription />
    </ExampleWrapper>
  );
}

function SonnerBasic() {
  return (
    <Example title="Basic" className="items-center justify-center">
      <Button onClick={() => toast("Event has been created")} variant="outline" className="w-fit">
        Show Toast
      </Button>
    </Example>
  );
}

function SonnerWithDescription() {
  return (
    <Example title="With Description" className="items-center justify-center">
      <Button
        onClick={() =>
          toast("Event has been created", {
            description: "Monday, January 3rd at 6:00pm",
          })
        }
        variant="outline"
        className="w-fit"
      >
        Show Toast
      </Button>
    </Example>
  );
}
