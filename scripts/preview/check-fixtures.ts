import type { Pull } from "../../web/src/pull-schemas.ts";

const openedAt = new Date(Date.now() - 6 * 60_000).toISOString();

/** Simulated GitHub responses for the isolated chat preview. */
export function previewPullChecks(pull: Pull, mode = "saved"): Pull {
  const savedAt = new Date().toISOString();
  const headSHA = "b7e29d4".padEnd(40, "0");
  const previous = pull.number === 18 || mode === "stale";
  const pending = pull.draft;
  const failed = pull.number === 19;
  let browserState = "success";
  if (pending) browserState = "pending";
  if (failed) browserState = "failure";
  if (mode !== "saved" && mode !== "stale") browserState = mode;
  return {
    ...pull,
    author: "octocat",
    authorAvatar: "https://avatars.githubusercontent.com/u/583231?v=4",
    createdAt: openedAt,
    metadataKnown: true,
    reviewers:
      pull.number === 18
        ? [{ name: "octocat", avatar: "https://avatars.githubusercontent.com/u/583231?v=4" }]
        : [],
    labels: pull.number === 18 ? ["bug", "compatibility"] : [],
    issues: {
      items:
        pull.number === 18
          ? [
              {
                number: 115,
                title: "Show GitHub PR checks and expanded PR details",
                url: "https://github.com/rhizomatous/flora/issues/115",
              },
            ]
          : [],
      checkedAt: savedAt,
      error: "",
    },
    headRef:
      (
        {
          18: "fix/pagination",
          19: "fix/pagination-release",
          42: "fix/cart-session",
          73: "fix/repository-focus",
        } as Record<number, string>
      )[pull.number] ?? "fix/update",
    baseRef: pull.number === 18 ? "main" : "release",
    body:
      pull.number === 18 || pull.number === 19
        ? "Keep notes stable between pages by using an ID alongside the timestamp in each cursor.\n\nExisting timestamp-only cursors remain supported. The replacement PR includes compatibility coverage for older clients and tests for notes created at the same time."
        : (pull.title ?? ""),
    headSHA,
    headCheckedAt: savedAt,
    checks: {
      sha: previous ? "a63c8f1".padEnd(40, "0") : headSHA,
      checkedAt: previous ? new Date(Date.now() - 3_600_000).toISOString() : savedAt,
      attemptedAt: savedAt,
      error: previous ? "GitHub rate limit reached. Saved checks are retained." : "",
      items: [
        { name: "Build", state: "success", url: "https://github.com/rhizomatous/flora/actions" },
        {
          name: "Browser tests",
          state: browserState,
          url: "https://github.com/rhizomatous/flora/actions",
        },
        {
          name: "Typecheck",
          state: "success",
          url: "https://github.com/rhizomatous/flora/actions",
        },
      ],
    },
  };
}
