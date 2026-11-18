import { useContext, type ComponentProps } from "react";
import { defaultComponents } from "streamdown";

import { Card } from "@flora/florets";
import { Markdown } from "@flora/florets/ai";

import { ChatPullContext, useLinkedPull } from "./pull-context";
import { InlinePullLink, PullList } from "./pull-links";

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
  const summary = useContext(ChatPullContext);
  const links = new Set(
    [
      ...children.matchAll(
        /https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?=[/?#\s)\]>.!,;]|$)/gi,
      ),
    ].map((match) => `https://github.com/${match[1]}/pull/${match[2]}`.toLowerCase()),
  );
  const pulls = summary?.items.filter((pull) => links.has(pull.url.toLowerCase())) ?? [];
  return (
    <>
      <Markdown components={components}>{children}</Markdown>
      {pulls.length > 0 && (
        <Card size="sm" className="mt-3 rounded-lg p-2" aria-label="Pull request details">
          <PullList
            checks="none"
            summary={{
              items: pulls,
              error: summary?.error ?? "",
              checkedAt: summary?.checkedAt ?? "",
            }}
          />
        </Card>
      )}
    </>
  );
}
