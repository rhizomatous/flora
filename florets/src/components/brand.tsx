import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export function FlowerMark(props: ComponentProps<"span">) {
  return <span {...props} aria-hidden="true">✿</span>;
}

export function Wordmark({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 text-lg font-semibold", className)} {...props}><FlowerMark /><span>Flora</span></div>;
}
