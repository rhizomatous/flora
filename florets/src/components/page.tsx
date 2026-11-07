import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export function Page({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("mx-auto min-h-svh max-w-2xl px-6 py-10 sm:px-10", className)} {...props} />;
}

export function PageHeader({ className, ...props }: ComponentProps<"header">) {
  return <header className={cn("mb-14 flex items-center justify-between gap-4", className)} {...props} />;
}

export function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />;
}

export function PageDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-3 text-sm leading-6 text-muted-foreground", className)} {...props} />;
}
