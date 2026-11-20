import type { Pull } from "./pull-schemas";

type Message = {
  ID: string;
  Role: string;
  Text: string;
  Payload: { parts: { type: string; text?: string | undefined }[] };
};

// Render one card for the first explicit creation announcement of each verified PR.
// Ordinary mentions and later updates remain inline links.
export function pullEvents(messages: Message[], pulls: Pull[]) {
  const events = new Map<string, { pull: Pull; opened: boolean }[]>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.Role !== "assistant") continue;
    const text =
      message.Payload.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n") || message.Text;
    const links = new Set(
      [
        ...text.matchAll(
          /\b(?:opened|created)\s+(?:\[[^\]]*\]\()?https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?=[/?#\s)\]>.!,;]|$)/gi,
        ),
      ].map((match) => `https://github.com/${match[1]}/pull/${match[2]}`.toLowerCase()),
    );
    for (const pull of pulls) {
      const key = pull.url.toLowerCase();
      if (seen.has(key) || !links.has(key)) continue;
      seen.add(key);
      events.set(message.ID, [...(events.get(message.ID) ?? []), { pull, opened: true }]);
    }
  }
  return events;
}
