import { describe, expect, it } from "vitest";

import { reportedModelLabel } from "./reported-model-label";

describe("reported model labels", () => {
  it("distinguishes missing summaries, no calls, and unreported metadata", () => {
    expect(reportedModelLabel().label).toBe("Reported model unavailable");
    expect(reportedModelLabel({ latest: null, models: 0 }).text).toBe("No reported model");
    expect(reportedModelLabel({ latest: { provider: "", model: "" }, models: 0 }).label).toBe(
      "Latest main-session model: Model not reported",
    );
    expect(
      reportedModelLabel({ latest: { provider: "", model: "custom-model" }, models: 1 }).label,
    ).toContain("Provider not reported / custom-model");
  });

  it("preserves reported IDs and explains model changes", () => {
    expect(
      reportedModelLabel({
        latest: { provider: "custom-provider", model: "custom-model" },
        models: 2,
      }),
    ).toEqual({
      text: "custom-model · 2 models",
      label:
        "Latest main-session model: custom-provider / custom-model. Main session used 2 reported models",
    });
  });
});
