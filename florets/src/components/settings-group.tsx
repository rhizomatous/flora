import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/utils";
import { Card } from "./card";
import { Field, FieldContent, FieldLabel } from "./field";

function SettingsGroup({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card variant="flush" {...props} className={cn("divide-y", className)} />;
}

/** Associate the control with htmlFor and its helper text with descriptionId via aria-describedby. */
function SettingsRow({
  label,
  htmlFor,
  description,
  descriptionId,
  children,
  className,
  ...props
}: ComponentProps<typeof Field> & {
  label: ReactNode;
  htmlFor: string;
  description?: ReactNode;
  descriptionId?: string;
}) {
  return (
    <Field
      orientation="horizontal"
      {...props}
      className={cn("items-center! justify-between gap-4 px-4 py-3", className)}
    >
      <FieldContent className="min-w-0 gap-1 leading-normal">
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {description !== undefined && (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </FieldContent>
      <div className="max-w-[55%] min-w-0 shrink-0">{children}</div>
    </Field>
  );
}

export { SettingsGroup, SettingsRow };
