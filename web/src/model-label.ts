import type { Execution } from "./execution-schema";

/** Format known model IDs without consulting defaults or a live model catalog. */
export function modelDisplayName(model: string) {
  const claude = /^claude-(sonnet|haiku|opus)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
  if (claude) {
    const family = claude[1] ?? "";
    return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${claude[2]}${claude[3] === undefined ? "" : `.${claude[3]}`}`;
  }
  const gpt = /^gpt-(\d+(?:\.\d+)?)(-(?:mini|nano|codex))?$/.exec(model);
  if (gpt) return `GPT-${gpt[1]}${gpt[2]?.replace("-", " ") ?? ""}`;
  return model;
}

export function modelChoiceLabel(choice?: Execution, name?: string) {
  if (choice === undefined || choice.model === "") {
    return { text: "Default model", label: "Chat model: installation default" };
  }
  return {
    text: name ?? modelDisplayName(choice.model),
    label: `Chat model: ${choice.provider} / ${choice.model}`,
  };
}
