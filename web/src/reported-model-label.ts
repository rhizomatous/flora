import type { Chat } from "./chat-schemas";

/** Format known reported IDs without consulting defaults or a live model catalog. */
export function reportedModelName(model: string) {
  const claude = /^claude-(sonnet|haiku|opus)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
  if (claude) {
    const family = claude[1] ?? "";
    return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${claude[2]}${claude[3] === undefined ? "" : `.${claude[3]}`}`;
  }
  const gpt = /^gpt-(\d+(?:\.\d+)?)(-(?:mini|nano|codex))?$/.exec(model);
  if (gpt) return `GPT-${gpt[1]}${gpt[2]?.replace("-", " ") ?? ""}`;
  return model;
}

export function reportedModelLabel(summary?: Chat["reportedModel"]) {
  if (summary === undefined) {
    return { text: "Model unavailable", label: "Reported model unavailable" };
  }
  if (summary.latest === null) {
    return { text: "No reported model", label: "No completed main-session model calls" };
  }
  const { provider, model } = summary.latest;
  const identity = model === "" ? "Model unavailable" : reportedModelName(model);
  const extra = summary.models > 1 ? ` · ${summary.models} models` : "";
  const details =
    model === ""
      ? "Model not reported"
      : `${provider === "" ? "Provider not reported" : provider} / ${model}`;
  return {
    text: identity + extra,
    label: `Latest main-session model: ${details}${summary.models > 1 ? `. Main session used ${summary.models} reported models` : ""}`,
  };
}
