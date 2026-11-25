import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  Alert,
  Button,
  ToggleGroup,
  ToggleGroupItem,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Card,
  CardContent,
  FieldLabel,
  LoadingStatus,
  Empty,
  Heading,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@flora/florets";

import { errorMessage, isExpired, request } from "./request";
import { usageReportSchema, type UsageReport, type UsageGroup } from "./usage-schemas";

type Metric = "cost" | "tokens";
const presets = [
  { id: "24h", days: 1 },
  { id: "7d", days: 7 },
  { id: "30d", days: 30 },
];
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
function money(value: number | null) {
  if (value === null) return "—";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function endOfDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() + 86_400_000).toISOString();
}
const count = (value: number) => value.toLocaleString();
const amount = (row: UsageGroup, metric: Metric) =>
  metric === "cost" ? (row.costUSD ?? 0) : row.tokens;

function MetricButtons({ value, onChange }: { value: Metric; onChange: (metric: Metric) => void }) {
  return (
    <ToggleGroup
      aria-label="Usage metric"
      size="sm"
      value={[value]}
      onValueChange={(values) => {
        const selected = values[0];
        if (selected === "cost" || selected === "tokens") onChange(selected);
      }}
    >
      {(["cost", "tokens"] as const).map((metric) => (
        <ToggleGroupItem key={metric} value={metric}>
          {metric === "cost" ? "Cost" : "Tokens"}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function UsageChart({ report, metric }: { report: UsageReport; metric: Metric }) {
  const maximum = Math.max(1, ...report.series.map((row) => amount(row, metric)));
  return (
    <div className="mt-6" aria-label={`${metric === "cost" ? "Cost" : "Tokens"} over time`}>
      <div className="mb-2 text-xs text-muted-foreground">
        {metric === "cost" ? money(maximum) : count(maximum)}
      </div>
      <div className="flex h-44 items-end gap-1 border-b border-border">
        {report.series.map((row) => (
          <Tooltip key={row.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`${new Date(row.id).toLocaleString(undefined, { timeZone: "UTC" })} UTC: ${metric === "cost" ? money(row.costUSD) : count(row.tokens)}`}
                  className="group flex h-full min-w-0 flex-1 items-end rounded-t-sm focus-visible:outline-2 focus-visible:outline-ring"
                />
              }
            >
              <span
                className="block w-full rounded-t-sm bg-foreground/65 group-hover:bg-foreground"
                style={{
                  height: `${Math.max(amount(row, metric) > 0 ? 1 : 0, (amount(row, metric) / maximum) * 100)}%`,
                }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {new Date(row.id).toLocaleString(undefined, { timeZone: "UTC" })} UTC
              <br />
              {metric === "cost" ? money(row.costUSD) : `${count(row.tokens)} tokens`}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{dateLabel(report.from)}</span>
        <span>UTC · {report.bucket === "hour" ? "Hourly" : "Daily"}</span>
        <span>{dateLabel(new Date(new Date(report.to).getTime() - 1).toISOString())}</span>
      </div>
    </div>
  );
}

function Breakdown({ report, metric }: { report: UsageReport; metric: Metric }) {
  const [group, setGroup] = useState("projects");
  const rows = (group === "projects" ? report.projects : report.models).toSorted(
    (a, b) => amount(b, metric) - amount(a, metric),
  );
  const maximum = Math.max(1, ...rows.map((row) => amount(row, metric)));
  return (
    <section aria-labelledby="breakdown-heading" className="min-w-0">
      <div className="mb-5 flex items-center justify-between gap-4">
        <Heading level={2} id="breakdown-heading" className="text-base">
          Breakdown
        </Heading>
        <Select
          items={[
            { value: "projects", label: "By project" },
            { value: "models", label: "By model" },
          ]}
          value={group}
          onValueChange={(value) => {
            if (value !== null) setGroup(value);
          }}
        >
          <SelectTrigger aria-label="Group usage by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectItem value="projects">By project</SelectItem>
            <SelectItem value="models">By model</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ul className="space-y-5">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="mb-2 flex justify-between gap-4 text-sm">
              <span className="truncate" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 tabular-nums">
                {metric === "cost" ? money(row.costUSD) : count(row.tokens)}
              </span>
            </div>
            <div className="h-1 rounded-full bg-muted">
              <div
                className="h-1 rounded-full bg-foreground/60"
                style={{ width: `${(amount(row, metric) / maximum) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ rows }: { rows: UsageReport["chats"] }) {
  const [sort, setSort] = useState("cost");
  const sorted = rows.toSorted((a, b) =>
    sort === "activity"
      ? b.lastActivity.localeCompare(a.lastActivity)
      : amount(b, sort === "tokens" ? "tokens" : "cost") -
        amount(a, sort === "tokens" ? "tokens" : "cost"),
  );
  return (
    <section aria-labelledby="history-heading" className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <Heading level={2} id="history-heading" className="text-base">
          Chats
        </Heading>
        <Select
          items={[
            { value: "cost", label: "Highest cost" },
            { value: "tokens", label: "Most tokens" },
            { value: "activity", label: "Last usage" },
          ]}
          value={sort}
          onValueChange={(value) => {
            if (value !== null) setSort(value);
          }}
        >
          <SelectTrigger aria-label="Sort chats">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectItem value="cost">Highest cost</SelectItem>
            <SelectItem value="tokens">Most tokens</SelectItem>
            <SelectItem value="activity">Last usage</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader className="border-b text-xs text-muted-foreground">
          <TableRow>
            <TableHead className="py-3 font-medium">Chat</TableHead>
            <TableHead className="px-4 font-medium">Project</TableHead>
            <TableHead className="px-4 text-right font-medium">Est. cost</TableHead>
            <TableHead className="px-4 text-right font-medium">Tokens</TableHead>
            <TableHead className="text-right font-medium">Last usage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.id} className="border-b border-border">
              <TableCell className="min-w-48 py-4">
                <a
                  href={`#chats/${encodeURIComponent(row.publicChatID)}`}
                  className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {row.label}
                </a>
              </TableCell>
              <TableCell className="px-4 text-muted-foreground">{row.project}</TableCell>
              <TableCell className="px-4 text-right tabular-nums">{money(row.costUSD)}</TableCell>
              <TableCell className="px-4 text-right tabular-nums">{count(row.tokens)}</TableCell>
              <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                {dateLabel(row.lastActivity)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function UsageResults({
  from,
  to,
  onExpired,
}: {
  from: string;
  to: string;
  onExpired: () => void;
}) {
  const [report, setReport] = useState<UsageReport>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [metric, setMetric] = useState<Metric>("cost");
  const expired = useEffectEvent(onExpired);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await request(usageReportSchema, `usage?${new URLSearchParams({ from, to })}`);
        if (active) {
          setReport(next);
          setError("");
        }
      } catch (e) {
        if (active) {
          setError(errorMessage(e, "Could not load usage."));
          if (isExpired(e)) expired();
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- An explicit retry must repeat the same request.
  }, [from, to, attempt]);
  if (error !== "") {
    return (
      <Alert className="mt-6" variant="destructive">
        {error}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAttempt(attempt + 1);
          }}
        >
          Retry
        </Button>
      </Alert>
    );
  }
  if (report === undefined) {
    return <LoadingStatus className="py-12">Loading usage…</LoadingStatus>;
  }
  if (report.total.steps === 0) {
    return (
      <Empty role="status" className="py-16 text-sm text-muted-foreground">
        No usage in this period.
      </Empty>
    );
  }
  return (
    <>
      <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <Card role="region" aria-label="Usage over time" className="min-w-0">
          <CardContent>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-3xl font-semibold tabular-nums">
                  {metric === "cost" ? money(report.total.costUSD) : count(report.total.tokens)}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {metric === "cost" ? "Estimated model cost" : "Tokens"}
                </p>
              </div>
              <MetricButtons value={metric} onChange={setMetric} />
            </div>
            <UsageChart report={report} metric={metric} />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Breakdown report={report} metric={metric} />
          </CardContent>
        </Card>
      </div>
      <details className="mt-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer">
          {count(report.total.tokens)} tokens · Token breakdown
        </summary>
        <dl className="mt-3 grid max-w-md grid-cols-2 gap-2">
          {[
            ["Input", report.total.input],
            ["Output", report.total.output],
            ["Reasoning", report.total.reasoning],
            ["Cache read", report.total.cacheRead],
            ["Cache write", report.total.cacheWrite],
          ].map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="text-right tabular-nums">{value?.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs">
          Total includes input, output, and cache tokens. Reasoning is shown separately because it
          may already be included in output.
        </p>
      </details>
      <History rows={report.chats} />
    </>
  );
}

export function UsagePage({ onExpired }: { onExpired: () => void }) {
  const [preset, setPreset] = useState("7d");
  const [now, setNow] = useState(() => new Date());
  const [start, setStart] = useState(() =>
    new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
  );
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const days = presets.find((option) => option.id === preset)?.days ?? 7;
  const from =
    preset === "custom"
      ? `${start}T00:00:00Z`
      : new Date(now.getTime() - days * 86_400_000).toISOString();
  const to = preset === "custom" ? endOfDay(end) : now.toISOString();
  const valid =
    preset !== "custom" ||
    (start !== "" &&
      end !== "" &&
      new Date(from) < new Date(to) &&
      new Date(to).getTime() - new Date(from).getTime() <= 366 * 86_400_000);
  return (
    <section aria-labelledby="usage-heading">
      <div className="flex items-center justify-between gap-4">
        <Heading level={1} id="usage-heading" ref={heading} tabIndex={-1}>
          Usage
        </Heading>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setNow(new Date());
          }}
        >
          Refresh
        </Button>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <ToggleGroup
          aria-label="Date range"
          size="sm"
          value={[preset]}
          className="flex-wrap"
          onValueChange={(values) => {
            const selected = values[0];
            if (typeof selected === "string") {
              setPreset(selected);
              setNow(new Date());
            }
          }}
        >
          {[...presets.map((option) => option.id), "custom"].map((id) => (
            <ToggleGroupItem key={id} value={id}>
              {id === "custom" ? "Custom" : id}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="ml-auto text-xs text-muted-foreground">UTC</span>
      </div>
      {preset === "custom" && (
        <div className="mt-4 flex flex-wrap gap-4">
          <FieldLabel htmlFor="usage-from" className="flex-col items-start">
            From
            <Input
              id="usage-from"
              type="date"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            />
          </FieldLabel>
          <FieldLabel htmlFor="usage-to" className="flex-col items-start">
            Through
            <Input
              id="usage-to"
              type="date"
              value={end}
              onChange={(event) => {
                setEnd(event.target.value);
              }}
            />
          </FieldLabel>
        </div>
      )}
      {valid ? (
        <UsageResults
          key={`${from}/${to}/${now.toISOString()}`}
          from={from}
          to={to}
          onExpired={onExpired}
        />
      ) : (
        <p role="alert" className="mt-6 text-sm">
          Choose a date range of up to 366 days.
        </p>
      )}
    </section>
  );
}
