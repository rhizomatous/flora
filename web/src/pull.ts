export function pullStatus(pull: {
  state: string;
  draft: boolean;
}): "open" | "draft" | "merged" | "closed" | "unknown" {
  if (pull.state === "open") return pull.draft ? "draft" : "open";
  if (pull.state === "merged") return "merged";
  if (pull.state === "closed") return "closed";
  return "unknown";
}
