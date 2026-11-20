export function pullAge(createdAt: string | undefined, now: number) {
  const stamp = Date.parse(createdAt ?? "");
  if (!Number.isFinite(stamp)) return "";
  const age = Math.max(0, now - stamp);
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  if (age < 604_800_000) return `${Math.floor(age / 86_400_000)}d ago`;
  return new Date(stamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(new Date(stamp).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}
