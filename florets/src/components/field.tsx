import type { ComponentProps } from "react";

import { cn } from "../lib/utils";
import { Text } from "./typography";

export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field" className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function FieldLabel({ className, htmlFor, children, ...props }: ComponentProps<"label">) {
  return (
    <label
      htmlFor={htmlFor}
      data-slot="field-label"
      className={cn("block text-sm font-medium", className)}
      {...props}
    >
      {children}
    </label>
  );
}

export function FieldDescription(props: ComponentProps<"p">) {
  return <Text data-slot="field-description" tone="muted" {...props} />;
}

export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("space-y-6", className)} {...props} />;
}

export function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset data-slot="fieldset" className={cn("space-y-6", className)} {...props} />;
}

export function FieldLegend({ className, ...props }: ComponentProps<"legend">) {
  return (
    <legend
      data-slot="field-legend"
      className={cn("mb-4 text-base font-semibold", className)}
      {...props}
    />
  );
}
