import type { UIMessage } from "ai";

export function getMessageText(message: Pick<UIMessage, "parts">) {
  let text = "";
  for (const part of message.parts) {
    if (part.type === "text") text += part.text;
  }
  return text;
}
