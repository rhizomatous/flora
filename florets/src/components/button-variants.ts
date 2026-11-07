import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-input bg-background hover:bg-muted",
        ghost: "hover:bg-muted",
        link: "text-muted-foreground underline underline-offset-4 hover:text-foreground",
      },
      size: {
        default: "px-4 py-2",
        sm: "px-3 py-1.5",
        inline: "p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
