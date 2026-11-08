import { Button, Link, Text } from "@flora/florets";

import type { Toast } from "./notifications";

export function CompletionToasts({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (sequence: number) => void;
}) {
  return (
    <aside
      aria-label="Completion notifications"
      aria-live="polite"
      aria-relevant="additions"
      className="fixed top-16 right-4 z-10 max-h-[40svh] w-[calc(100%-2rem)] max-w-sm space-y-3 overflow-auto rounded-md"
    >
      {toasts.map((t) => (
        <div
          key={t.Sequence}
          className="rounded-md border border-foreground/40 bg-background p-4 shadow-lg"
        >
          <Text className="break-words">
            <Link className="font-medium" href={`#chats/${encodeURIComponent(t.ChatID)}`}>
              {t.title}
            </Link>{" "}
            finished work.
          </Text>
          <Button
            variant="link"
            size="sm"
            type="button"
            className="mt-3 text-sm text-foreground"
            aria-label={`Dismiss completion for ${t.title}`}
            onClick={() => {
              dismiss(t.Sequence);
            }}
          >
            Dismiss
          </Button>
        </div>
      ))}
    </aside>
  );
}
