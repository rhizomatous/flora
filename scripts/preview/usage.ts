import type { UsageGroup, UsageReport } from "../../web/src/usage-schemas.ts";

const empty = () => ({
  costUSD: null as number | null,
  tokens: 0,
  steps: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});
const group = (id: string, label: string, project = ""): UsageGroup => ({
  id,
  label,
  project,
  lastActivity: "",
  ...empty(),
});
function add(target: ReturnType<typeof empty>, row: ReturnType<typeof empty>) {
  target.costUSD = (target.costUSD ?? 0) + (row.costUSD ?? 0);
  target.tokens += row.tokens;
  target.steps += row.steps;
  target.input += row.input;
  target.output += row.output;
  target.reasoning += row.reasoning;
  target.cacheRead += row.cacheRead;
  target.cacheWrite += row.cacheWrite;
}

/** Populated accounting fixtures use runtime dates so every range filters the same records. */
export function previewUsage(
  from: string,
  to: string,
): Omit<UsageReport, "chats"> & { chats: UsageGroup[] } {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const bucket = end - start <= 48 * 3_600_000 ? "hour" : "day";
  const size = bucket === "hour" ? 3_600_000 : 86_400_000;
  const total = empty();
  const series = new Map<string, UsageGroup>();
  const projects = new Map<string, UsageGroup>();
  const models = new Map<string, UsageGroup>();
  const chats = new Map<string, UsageGroup>();
  for (let stamp = Math.floor(start / size) * size; stamp < end; stamp += size) {
    const id = new Date(stamp).toISOString();
    series.set(id, group(id, id));
  }
  const examples = [
    {
      id: "completed",
      label: "Review the workspace changes",
      project: "Flora",
      model: "anthropic/claude-sonnet-4-5",
    },
    {
      id: "long",
      label: "Improve keyboard navigation",
      project: "Garden storefront",
      model: "openai/gpt-5",
    },
    {
      id: "recovery",
      label: "Fix the workspace checks",
      project: "Fieldnotes",
      model: "anthropic/claude-sonnet-4-5",
    },
    {
      id: "waiting",
      label: "Move project settings into the menu",
      project: "Flora",
      model: "openai/gpt-5",
    },
  ];
  const now = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  for (let i = 0; i < 120; i++) {
    const stamp = now - i * 6 * 3_600_000;
    if (stamp < start || stamp >= end) continue;
    const example = examples[i % examples.length];
    if (example === undefined) continue;
    const weight = 1 + ((i * 7) % 13);
    const row = {
      costUSD: weight * 0.137,
      input: weight * 12_000,
      output: weight * 2300,
      reasoning: weight * 400,
      cacheRead: weight * 8000,
      cacheWrite: weight * 900,
      steps: weight * 3,
      tokens: weight * 23_200,
    };
    add(total, row);
    const date = new Date(Math.floor(stamp / size) * size).toISOString();
    for (const [map, id, label, project] of [
      [series, date, date, ""],
      [projects, example.project, example.project, ""],
      [models, example.model, example.model, ""],
      [chats, example.id, example.label, example.project],
    ] as const) {
      const value = map.get(id) ?? group(id, label, project);
      add(value, row);
      const last = new Date(stamp).toISOString();
      if (last > value.lastActivity) value.lastActivity = last;
      map.set(id, value);
    }
  }
  return {
    from,
    to,
    bucket,
    total,
    series: [...series.values()],
    projects: [...projects.values()],
    models: [...models.values()],
    chats: [...chats.values()],
  };
}
