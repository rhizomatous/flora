import type { ComponentProps } from "react";

import { headingStyles } from "../lib/typography";
import { cn } from "../lib/utils";

type EditableTextProps = {
  label: string;
  variant?: "title" | "body";
} & (
  | ({ multiline?: false } & Omit<ComponentProps<"input">, "type">)
  | ({ multiline: true } & ComponentProps<"textarea">)
);

/** Edits plain text in place using native form controls. The caller owns saving the value. */
function EditableText({ label, variant = "body", className, ...props }: EditableTextProps) {
  const classes = cn(
    "block w-full min-w-0 rounded-lg border border-transparent bg-transparent px-4 py-2 text-foreground transition-colors outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
    variant === "title" ? headingStyles({ level: 1 }) : "text-base",
    className,
  );
  if (props.multiline === true) {
    const { multiline, ...textareaProps } = props;
    return (
      <textarea
        data-slot="editable-text"
        data-multiline={multiline}
        aria-label={label}
        rows={1}
        {...textareaProps}
        className={cn("field-sizing-content resize-none", classes)}
      />
    );
  }
  const { multiline, ...inputProps } = props;
  return (
    <input
      data-slot="editable-text"
      data-multiline={multiline}
      aria-label={label}
      type="text"
      {...inputProps}
      className={classes}
    />
  );
}

export { EditableText };
