import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";

import { Link, Toaster } from "@flora/florets";

import type { Toast } from "./notifications";

export function CompletionToasts({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (sequence: number) => void;
}) {
  const presented = useRef(new Map<number, string>());
  const remove = useEffectEvent(dismiss);

  useEffect(() => {
    const active = new Set(toasts.map((completion) => completion.Sequence));
    for (const [sequence, id] of presented.current) {
      if (!active.has(sequence)) {
        toast.dismiss(id);
        presented.current.delete(sequence);
      }
    }
    for (const completion of toasts) {
      if (presented.current.has(completion.Sequence)) continue;
      const id = `completion-${completion.Sequence}`;
      presented.current.set(completion.Sequence, id);
      toast.success("Work complete", {
        id,
        toasterId: "completions",
        description: (
          <Link
            className="line-clamp-2 break-words text-muted-foreground no-underline hover:underline"
            href={`#chats/${encodeURIComponent(completion.publicChatID)}`}
            onClick={() => {
              toast.dismiss(id);
              remove(completion.Sequence);
            }}
          >
            {completion.title}
          </Link>
        ),
        onDismiss: () => {
          remove(completion.Sequence);
        },
        onAutoClose: () => {
          remove(completion.Sequence);
        },
      });
    }
  }, [toasts]);

  useEffect(() => {
    const shown = presented.current;
    return () => {
      for (const id of shown.values()) toast.dismiss(id);
      shown.clear();
    };
  }, []);

  return (
    <Toaster
      id="completions"
      position="top-right"
      offset={{ top: "4rem", right: "1rem" }}
      mobileOffset={{ top: "4rem", right: "1rem", left: "1rem" }}
      customAriaLabel="Completion notifications"
      hotkey={["altKey", "KeyN"]}
      duration={6000}
      visibleToasts={3}
      closeButton
      toastOptions={{
        closeButtonAriaLabel: "Dismiss completion",
        classNames: {
          toast: "florets-toast gap-3! py-3! pr-10! font-sans text-sm!",
          success: "[&_[data-icon]]:text-green-700 dark:[&_[data-icon]]:text-green-400",
          icon: "mt-0.5! self-start",
          closeButton:
            "top-3! right-3! left-auto! transform-none! rounded-sm! border-0! bg-transparent! text-muted-foreground! hover:bg-control-hover!",
        },
      }}
    />
  );
}
