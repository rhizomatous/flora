import { useState } from "react";

import {
  Button,
  DropdownMenuItem,
  DropdownMenuSeparator,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@flora/florets";

import type { Part } from "./chat-schemas";
import { useSubagents, subagentLabel, subagentStatus, subagentSession } from "./subagent-state";
import { formatDuration } from "./transcript";

export function SubagentMenuItems() {
  const { agents, open } = useSubagents();
  if (agents.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <p className="px-2 py-1 text-xs text-muted-foreground">Subagents</p>
      {agents.map((agent) => (
        <DropdownMenuItem
          key={agent.id}
          onClick={() => {
            open(agent.id);
          }}
        >
          <span className="min-w-0">
            <span className="block">{subagentLabel(agent)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {agent.title || "Delegated task"}
            </span>
          </span>
          <span className="ml-auto text-xs text-muted-foreground">{subagentStatus(agent)}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
}
export function SubagentList() {
  const { agents, open } = useSubagents();
  if (agents.length === 0) return null;
  return (
    <section aria-label="Subagents" className="mt-4">
      <h3 className="rounded-md bg-muted/30 px-3 py-2 text-sm">
        Subagents <span className="text-muted-foreground">{agents.length}</span>
      </h3>
      {agents.map((agent) => (
        <Button
          key={agent.id}
          variant="ghost"
          className="h-auto w-full justify-start py-3 text-left"
          onClick={() => {
            open(agent.id);
          }}
        >
          <span className="min-w-0">
            <span className="block">
              {subagentLabel(agent)} · {subagentStatus(agent)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {agent.title || "Delegated task"}
            </span>
          </span>
        </Button>
      ))}
    </section>
  );
}
export function SubagentLink({ part }: { part: Part }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { agents, open } = useSubagents();
  const agent = agents.find((item) => item.id === subagentSession(part));
  if (!agent) return <span>Subagent</span>;
  const time = part.state?.time;
  return (
    <HoverCard open={previewOpen} onOpenChange={setPreviewOpen}>
      <HoverCardTrigger
        onMouseEnter={() => {
          setPreviewOpen(true);
        }}
        onFocus={() => {
          setPreviewOpen(true);
        }}
        onBlur={() => {
          setPreviewOpen(false);
        }}
        render={<button type="button" aria-label={subagentLabel(agent)} />}
        className="rounded-sm text-sm text-primary underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          setPreviewOpen(false);
          open(agent.id);
        }}
      >
        {subagentLabel(agent)}
      </HoverCardTrigger>
      <HoverCardContent className="w-72 space-y-2">
        <p className="text-xs text-muted-foreground">{subagentLabel(agent)}</p>
        <p className="text-sm">{agent.title || "Delegated task"}</p>
        <p className="border-t pt-2 text-xs text-muted-foreground">
          {subagentStatus(agent)}
          {agent.collection !== "complete" && " · History incomplete"}
          {time?.end !== undefined && ` · ${formatDuration(Math.max(0, time.end - time.start))}`}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
