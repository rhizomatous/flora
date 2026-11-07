import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const headingLevels = {
  1: { tag: "h1", className: "text-2xl leading-8 tracking-tight" },
  2: { tag: "h2", className: "text-lg leading-7" },
  3: { tag: "h3", className: "text-base leading-6" },
  4: { tag: "h4", className: "text-sm leading-5" },
  5: { tag: "h5", className: "text-sm leading-5" },
  6: { tag: "h6", className: "text-xs leading-4" },
} as const;

export type HeadingProps = ComponentProps<"h1"> & { level: keyof typeof headingLevels };

/** Renders the requested heading level with its default type scale and no outer spacing. */
export function Heading({ level, className, children, ...props }: HeadingProps) {
  const { tag: Tag, className: typography } = headingLevels[level];
  return (
    <Tag className={cn("font-semibold text-foreground", typography, className)} {...props}>
      {children}
    </Tag>
  );
}

const textSizes = {
  xs: "text-xs leading-4",
  sm: "text-sm leading-6",
  md: "text-base leading-7",
} as const;

const textTones = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  inherit: "text-inherit",
} as const;

type TextStyleProps = {
  size?: keyof typeof textSizes;
  tone?: keyof typeof textTones;
};

export type TextProps = TextStyleProps &
  ((ComponentProps<"p"> & { as?: "p" }) | (ComponentProps<"span"> & { as: "span" }));

/** Uses paragraph semantics by default; inline text retains span props and refs. */
export function Text({ size = "sm", tone = "default", className, ...props }: TextProps) {
  const classes = cn("font-normal", textSizes[size], textTones[tone], className);
  if (props.as === "span") {
    const { as: Tag, ...spanProps } = props;
    return <Tag className={classes} {...spanProps} />;
  }
  const { as: Tag = "p", ...paragraphProps } = props;
  return <Tag className={classes} {...paragraphProps} />;
}
