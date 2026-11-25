const publicIDs = new Map<string, string>();
const projectPrefixes = new Map<string, string>();
const projectCounters = new Map<string, number>();
export function publicID(id: string, projectID: string, projectName: string) {
  const saved = publicIDs.get(id);
  if (saved !== undefined) return saved;
  let prefix = projectPrefixes.get(projectID);
  if (prefix === undefined) {
    const letters = projectName.replaceAll(/[^A-Za-z]/gu, "").toUpperCase() || "CHAT";
    const base = letters.slice(0, 4);
    const extra = Math.min(8, letters.length) - base.length;
    const taken = new Set(projectPrefixes.values());
    for (let attempt = 0; ; attempt++) {
      let candidate = letters.slice(0, base.length + attempt);
      if (attempt > extra) {
        let suffix = "";
        for (let number = attempt - extra; number > 0; number = Math.floor(number / 26)) {
          number--;
          suffix = String.fromCodePoint(65 + (number % 26)) + suffix;
        }
        candidate = base + suffix;
      }
      if (!taken.has(candidate)) {
        prefix = candidate;
        projectPrefixes.set(projectID, prefix);
        break;
      }
    }
  }
  const number = (projectCounters.get(projectID) ?? 0) + 1;
  projectCounters.set(projectID, number);
  const canonical = `${prefix}-${number}`;
  publicIDs.set(id, canonical);
  return canonical;
}
