import { Button, ExternalLinkIcon } from "@flora/florets";

import type { Pull } from "./pull-schemas";

export function PullActions({ pull }: { pull: Pull }) {
  return (
    <div className="flex items-center justify-end px-5 py-3 sm:px-6">
      <Button
        variant="secondary"
        size="compact"
        nativeButton={false}
        role="link"
        render={
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open PR #${pull.number} on GitHub`}
          />
        }
        aria-label={`Open PR #${pull.number} on GitHub`}
      >
        <ExternalLinkIcon /> Open on GitHub
      </Button>
    </div>
  );
}
