import type { Chat } from "./chat-schemas";

const appearances = {
  working: { id: "working", label: "Working", tone: "working" },
  waiting: { id: "waiting", label: "Needs you", tone: "attention" },
  idle: { id: "idle", label: "Idle", tone: "neutral" },
  failed: { id: "failed", label: "Failed", tone: "failed" },
  stopped: { id: "stopped", label: "Stopped", tone: "neutral" },
} as const;

export const chatStatuses = Object.values(appearances);

// The backend also uses waiting for automatic provider retries, which need no user action.
// Seen state changes the marker fill, never the status or its label.
export function chatStatus(chat: Pick<Chat, "Status" | "StatusReason">, seen = false) {
  const id =
    chat.Status === "waiting" && chat.StatusReason === "Waiting for the model provider to retry"
      ? "working"
      : chat.Status;
  const appearance = appearances[id];
  const starting =
    id === "working" &&
    ["Message accepted", "Preparing checkout and setup"].includes(chat.StatusReason);
  return {
    ...appearance,
    filled: id === "working" ? !starting : id === "failed" || (id !== "stopped" && !seen),
    pulse: id === "working",
  };
}
