import type { ComponentProps } from "react";

import floraMark from "../assets/flora.svg";
import { cn } from "../lib/utils";

export function FlowerMark({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn("inline-flex shrink-0 align-middle", className)}
      aria-hidden="true"
    >
      <img src={floraMark} alt="" className="h-[1em] w-[1em]" draggable={false} />
    </span>
  );
}

export function Wordmark({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center gap-2 text-lg font-semibold", className)} {...props}>
      <FlowerMark className="text-2xl" />
      <span>Flora</span>
    </div>
  );
}
