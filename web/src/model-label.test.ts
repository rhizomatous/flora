import { describe, expect, it } from "vitest";

import { resolveModelChoice } from "./model-choice";
import { modelChoiceLabel, modelDisplayName } from "./model-label";

describe("chat model choice", () => {
  const fallback = { provider: "provider", model: "default-model", variant: "" };
  const saved = { provider: "provider", model: "claude-sonnet-4-6", variant: "high" };
  const draft = { provider: "provider", model: "claude-haiku-4-5", variant: "" };

  it("uses a browser draft, then the accepted chat choice, then the default", () => {
    expect(resolveModelChoice(draft, saved, fallback)).toBe(draft);
    expect(resolveModelChoice(null, saved, fallback)).toBe(saved);
    expect(resolveModelChoice(null, { provider: "", model: "", variant: "" }, fallback)).toBe(
      fallback,
    );
    expect(resolveModelChoice(null, undefined, fallback)).toBe(fallback);
  });

  it("shows a single model and preserves its exact identity in the accessible label", () => {
    expect(modelChoiceLabel(draft)).toEqual({
      text: "Claude Haiku 4.5",
      label: "Chat model: provider / claude-haiku-4-5",
    });
    expect(modelChoiceLabel(draft, "Haiku").text).toBe("Haiku");
    expect(modelChoiceLabel().text).toBe("Default model");
  });

  it.each([
    ["claude-haiku-4-5", "Claude Haiku 4.5"],
    ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
    ["claude-sonnet-4-20250514", "Claude Sonnet 4"],
    ["gpt-5.1-mini", "GPT-5.1 mini"],
    ["custom-model-2026", "custom-model-2026"],
  ])("formats model ID %s", (id, name) => {
    expect(modelDisplayName(id)).toBe(name);
  });
});
