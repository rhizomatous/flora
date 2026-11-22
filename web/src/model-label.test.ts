import { describe, expect, it } from "vitest";

import { resolveModelChoice } from "./model-choice";
import { modelChoiceLabel, modelDisplayName } from "./model-label";

describe("chat model choice", () => {
  const fallback = { provider: "provider", model: "default-model", variant: "" };
  const current = { provider: "provider", model: "claude-haiku-4-5", variant: "" };

  it("uses the chat's current choice or the installation default", () => {
    expect(resolveModelChoice(current, fallback)).toBe(current);
    expect(resolveModelChoice({ provider: "", model: "", variant: "" }, fallback)).toBe(fallback);
    expect(resolveModelChoice(null, fallback)).toBe(fallback);
  });

  it("shows a single model and preserves its exact identity in the accessible label", () => {
    expect(modelChoiceLabel(current)).toEqual({
      text: "Claude Haiku 4.5",
      label: "Chat model: provider / claude-haiku-4-5",
    });
    expect(modelChoiceLabel(current, "Haiku").text).toBe("Haiku");
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
