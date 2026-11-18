import { cva } from "class-variance-authority";

export const headingStyles = cva("font-medium text-foreground", {
  variants: {
    level: {
      1: "text-2xl leading-8 tracking-tight",
      2: "text-lg leading-7",
      3: "text-base leading-6",
      4: "text-sm leading-5",
      5: "text-sm leading-5",
      6: "text-xs leading-4",
    },
  },
});
