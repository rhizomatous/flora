import type { ComponentProps } from "react";

export function FlowerMark(props: ComponentProps<"span">) {
  return (
    <span {...props} aria-hidden="true">
      ✿
    </span>
  );
}
