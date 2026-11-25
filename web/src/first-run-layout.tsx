import type { ReactNode } from "react";

import { Wordmark } from "@flora/florets";

export function FirstRunLayout({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="first-run min-h-svh bg-surface-shell">
      <header className="relative flex min-h-20 items-center justify-between gap-4 px-5 sm:px-10">
        <a
          href="#chats/new"
          aria-label="Flora home"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Wordmark />
        </a>
        <div className="flex flex-wrap justify-end gap-2">{actions}</div>
      </header>
      <main
        id="main-content"
        className={`relative mx-auto flex min-h-[calc(100svh-5rem)] w-full flex-col justify-center px-4 py-8 sm:px-8 sm:py-16 ${actions === undefined ? "max-w-lg" : "max-w-3xl"}`}
      >
        <div className="rounded-xl border border-border bg-surface-canvas p-5 sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
