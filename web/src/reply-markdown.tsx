import type { ComponentProps } from "react";
import { defaultComponents } from "streamdown";

import { Markdown } from "@flora/florets/ai";

import { useLinkedPull } from "./pull-context";
import { InlinePullLink } from "./pull-links";

function ReplyLink(props: ComponentProps<typeof defaultComponents.a>) {
  const pull = useLinkedPull(props.href);
  if (pull && props.href !== undefined) {
    return (
      <InlinePullLink pull={pull} href={props.href}>
        {props.children}
      </InlinePullLink>
    );
  }
  const DefaultLink = defaultComponents.a;
  return <DefaultLink {...props} />;
}

const components = { a: ReplyLink };

export function ReplyMarkdown({ children }: { children: string }) {
  return <Markdown components={components}>{children}</Markdown>;
}
