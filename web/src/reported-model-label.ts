import type { Chat } from "./chat-schemas";

export function reportedModelLabel(summary?: Chat["reportedModel"]) {
  if (summary === undefined) {
    return { text: "Model unavailable", label: "Reported model unavailable" };
  }
  if (summary.latest === null) {
    return { text: "No reported model", label: "No completed main-session model calls" };
  }
  const { provider, model } = summary.latest;
  const identity = model === "" ? "Model unavailable" : model;
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
