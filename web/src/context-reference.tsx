import {
  FileTypeIcon,
  MessageSquareIcon,
  GitPullRequestIcon,
  GitPullRequestDraftIcon,
  GitPullRequestClosedIcon,
  GitMergeIcon,
} from "@flora/florets";

import { type ContextReference, referenceLocation, referenceKey } from "./context-schema";
import { pullTones } from "./pull-appearance";

const pulls = {
  open: { Icon: GitPullRequestIcon, color: pullTones.success },
  draft: { Icon: GitPullRequestDraftIcon, color: pullTones.neutral },
  closed: { Icon: GitPullRequestClosedIcon, color: pullTones.failure },
  merged: { Icon: GitMergeIcon, color: pullTones.merged },
  unknown: { Icon: GitPullRequestIcon, color: pullTones.neutral },
};

export function ContextReferenceIcon({ reference }: { reference: ContextReference }) {
  if (reference.kind === "file") return <FileTypeIcon path={reference.path} />;
  if (reference.kind === "chat") {
    return (
      <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    );
  }
  const status = reference.status ?? "unknown";
  const { Icon, color } = pulls[status];
  return (
    <span
      role="img"
      aria-label={`${status} pull request`}
      className={`inline-flex shrink-0 ${color}`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

export function ContextReferenceLabel({ reference }: { reference: ContextReference }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={referenceLocation(reference)}>
      <ContextReferenceIcon reference={reference} />
      <span className="truncate">{reference.label}</span>
    </span>
  );
}

export function SentContextReferences({ references }: { references: ContextReference[] }) {
  return (
    <div
      data-slot="message-context"
      className="flex max-w-full flex-wrap justify-end gap-x-3 gap-y-1"
      aria-label="Sent context"
    >
      {references.map((reference) => (
        <span key={referenceKey(reference)} className="inline-flex max-w-full min-w-0 text-sm">
          <ContextReferenceLabel reference={reference} />
        </span>
      ))}
    </div>
  );
}
