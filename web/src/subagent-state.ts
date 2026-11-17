import { createContext, useContext } from "react";

import { useChatPanelState } from "./chat-panel-state";
import type { Part, Subagent } from "./chat-schemas";

export const SubagentPaneContext = createContext<"main" | "side">("main");

export const SubagentsContext = createContext<{ chatID: string; agents: Subagent[] }>({
  chatID: "",
  agents: [],
});
export function subagentLabel(agent: Subagent) {
  return `Subagent ${agent.number}`;
}
export function subagentStatus(agent: Subagent) {
  return {
    working: "Working",
    waiting: "Waiting",
    idle: "Finished",
    failed: "Failed",
    stopped: "Stopped",
    unknown: "Status unknown",
  }[agent.status];
}
export function useSubagents() {
  const context = useContext(SubagentsContext);
  const pane = useContext(SubagentPaneContext);
  const [state, update] = useChatPanelState(context.chatID);
  return {
    ...context,
    open: (id: string) => {
      if (pane === "side") {
        update({ view: `subagent:${id}`, subagentTabs: [...new Set([...state.subagentTabs, id])] });
      } else {
        update({
          mainView: `subagent:${id}`,
          mainSubagentTabs: [...new Set([...state.mainSubagentTabs, id])],
        });
      }
    },
  };
}
export function subagentSession(part: Part): string | undefined {
  const metadata = part.state?.metadata;
  if (
    part.type !== "tool" ||
    metadata === null ||
    metadata === undefined ||
    typeof metadata !== "object" ||
    !("sessionId" in metadata)
  ) {
    return;
  }
  return typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;
}
