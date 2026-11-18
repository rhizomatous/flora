import type { ComponentProps } from "react";

import { headingStyles } from "../lib/typography";
import { cn } from "../lib/utils";

const headingTags = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

export type HeadingProps = ComponentProps<"h1"> & { level: keyof typeof headingTags };

/** Renders the requested heading level with its default type scale and no outer spacing. */
export function Heading({ level, className, children, ...props }: HeadingProps) {
  const Tag = headingTags[level];
  return (
    <Tag className={cn(headingStyles({ level }), "outline-none", className)} {...props}>
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
  subtle: "text-subtle-foreground",
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
