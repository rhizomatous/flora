import type { Pull } from "../../web/src/pull-schemas.ts";

/** Simulated GitHub responses for the isolated chat preview. */
export function previewPullChecks(pull: Pull): Pull {
  const savedAt = new Date().toISOString();
  const headSHA = "b7e29d4".padEnd(40, "0");
  const previous = pull.number === 18;
  const pending = pull.draft;
  const failed = pull.number === 19;
  let browserState = "success";
  if (pending) browserState = "pending";
  if (failed) browserState = "failure";
  return {
    ...pull,
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
