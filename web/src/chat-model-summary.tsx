import type { Chat } from "./chat-schemas";
import { resolveModelChoice, useModelChoice } from "./model-choice";
import { useModelDiscovery } from "./model-discovery";
import { ModelIcon } from "./model-icon";
import { modelChoiceLabel } from "./model-label";

/** Show the same next-message model choice as the composer, including its saved browser draft. */
export function ChatModelSummary({ chat }: { chat: Chat }) {
  const scope = `chat:${chat.ID}`;
  const { selected } = useModelChoice(scope);
  const { options } = useModelDiscovery(scope);
  const choice = resolveModelChoice(selected, chat.Execution, options?.default);
  const model = options?.models.find(
    (entry) => entry.provider === choice?.provider && entry.id === choice.model,
  );
  const { text, label } = modelChoiceLabel(choice, model?.name);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="chat-summary-model inline-flex max-w-full min-w-0 items-center gap-1.5 text-muted-foreground"
    >
      <ModelIcon provider={choice?.provider} model={choice?.model} />
      <span className="truncate">{text}</span>
    </span>
  );
}
