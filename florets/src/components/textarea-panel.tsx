import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { Card } from "./card";
import { Textarea } from "./textarea";

function TextareaPanel({ className, ...props }: ComponentProps<typeof Card>) {
  return (
    <Card
      variant="flush"
      {...props}
      className={cn("has-[[aria-invalid=true]]:border-destructive", className)}
    />
  );
}

function TextareaPanelInput({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      {...props}
      className={cn("min-h-32 resize-none border-0 bg-transparent", className)}
    />
  );
}

function TextareaPanelFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div {...props} className={cn("flex flex-wrap items-center gap-2 px-4 pb-3", className)} />
  );
}

export { TextareaPanel, TextareaPanelInput, TextareaPanelFooter };
