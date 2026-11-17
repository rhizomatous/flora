import type { Pull } from "./pull-schemas";

export function pullChecksSummary(pull: Pull, now = Date.now()) {
  const { checks } = pull;
  const stamp = Date.parse(checks?.checkedAt ?? "");
  const stale =
    (checks?.error ?? "") !== "" ||
    (pull.headSHA ?? "") === "" ||
    checks?.sha !== pull.headSHA ||
    (checks?.checkedAt ?? "") === "" ||
    !Number.isFinite(stamp) ||
    now - stamp > 120_000;
  const items = checks?.items ?? [];
  const count = (state: string) => items.filter((item) => item.state === state).length;
  const failed = count("failure");
  const pending = count("pending");
  const passed = count("success");
  const skipped = count("neutral");
  const unavailable = items.length - failed - pending - passed - skipped;
  let label = "No checks reported";
  let state = "unavailable";
  if ((checks?.checkedAt ?? "") === "") label = "Checks unavailable";
  else if (items.length > 0) {
    label = [
      failed > 0 && `${failed} failed`,
      pending > 0 && `${pending} pending`,
      passed > 0 && `${passed} passed`,
      skipped > 0 && `${skipped} skipped`,
      unavailable > 0 && `${unavailable} unavailable`,
    ]
      .filter(Boolean)
      .join(" · ");
    state = "neutral";
    if (passed > 0) state = "success";
    if (unavailable > 0) state = "unavailable";
    if (pending > 0) state = "pending";
    if (failed > 0) state = "failure";
  }
  return { label, state: stale ? "unavailable" : state, stale };
}
