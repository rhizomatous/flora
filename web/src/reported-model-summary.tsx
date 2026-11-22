import type { Chat } from "./chat-schemas";
import { ModelIcon } from "./model-icon";
import { reportedModelLabel } from "./reported-model-label";

/** Both chat summaries use saved reported identities without consulting model choices. */
export function ReportedModelSummary({ summary }: { summary: Chat["reportedModel"] }) {
  const { text, label } = reportedModelLabel(summary);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="chat-summary-model inline-flex max-w-full min-w-0 items-center gap-1.5 text-muted-foreground"
    >
      <ModelIcon provider={summary?.latest?.provider} model={summary?.latest?.model} />
      <span className="truncate">{text}</span>
    </span>
  );
}
