import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  Progress,
} from "@flora/florets";

import type { ContextUsage } from "./chat-schemas";

const tokens = (value: number) =>
  value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function ContextUsagePopover({ usage }: { usage: ContextUsage | undefined }) {
  const used = usage?.tokens ?? null;
  const limit = usage?.limit ?? null;
  const percentage = used !== null && limit !== null ? Math.round((used / limit) * 100) : null;
  const fill = percentage === null ? 0 : Math.min(100, percentage);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="composer-context ml-auto size-7!"
            aria-label="Context usage"
            title={percentage === null ? "Context usage" : `Context usage: ${percentage}%`}
          >
            <svg className="size-3.5" viewBox="0 0 20 20" aria-hidden="true">
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-border"
              />
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                pathLength="100"
                strokeDasharray={`${fill} 100`}
                transform="rotate(-90 10 10)"
              />
            </svg>
          </Button>
        }
      />
      <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-24px)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PopoverTitle className="text-base font-semibold">Context</PopoverTitle>
          <span
            className="text-sm text-muted-foreground tabular-nums"
            title={
              used === null
                ? undefined
                : `${used.toLocaleString()} / ${limit?.toLocaleString() ?? "—"} tokens`
            }
          >
            {used === null
              ? "—"
              : `${tokens(used)} / ${limit === null ? "—" : tokens(limit)}${percentage === null ? "" : ` (${percentage}%)`}`}
          </span>
        </div>
        {percentage !== null && (
          <Progress
            value={fill}
            aria-label="Context window used"
            aria-valuetext={`${percentage}% of ${limit?.toLocaleString()} tokens`}
            className="my-1 [&_[data-slot=progress-indicator]]:bg-foreground"
          />
        )}
        <PopoverDescription className="text-xs">
          {used === null ? "No context usage yet." : "Latest model call"}
          {used !== null && usage?.model !== "" && (
            <span className="mt-1 block break-words">{usage?.model}</span>
          )}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
