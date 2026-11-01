import type { Toast } from "./notifications";
import { link } from "./ui";

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
      className="fixed right-4 bottom-4 z-10 max-h-[40svh] w-[calc(100%-2rem)] max-w-sm space-y-3 overflow-auto rounded-md"
    >
      {toasts.map((t) => (
        <div
          key={t.Sequence}
          className="rounded-md border border-foreground/40 bg-background p-4 shadow-lg"
        >
          <p className="text-sm break-words">
            <a className={`${link} font-medium`} href={`#chats/${encodeURIComponent(t.ChatID)}`}>
              {t.title}
            </a>{" "}
            finished work.
          </p>
          <button
            type="button"
            className={`${link} mt-3 text-sm`}
            aria-label={`Dismiss completion for ${t.title}`}
            onClick={() => {
              dismiss(t.Sequence);
            }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </aside>
  );
}
