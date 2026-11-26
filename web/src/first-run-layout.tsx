import type { ReactNode } from "react";

import { Card, FlowerMark, Wordmark } from "@flora/florets";

export function FirstRunLayout({
  children,
  actions,
  progress,
}: {
  children: ReactNode;
  actions?: ReactNode;
  progress?: ReactNode;
}) {
  const setup = actions !== undefined;
  return (
    <div
      className={`first-run min-h-svh bg-surface-shell ${setup ? "first-run-setup" : "first-run-auth"}`}
    >
      <header className="relative z-10 flex min-h-20 items-center justify-between gap-4 px-5 sm:px-8">
        <a
          href="#chats/new"
          aria-label="Flora home"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Wordmark />
        </a>
        <div className="flex flex-wrap justify-end gap-1">{actions}</div>
      </header>
      <main
        id="main-content"
        className={
          setup
            ? "first-run-stage relative mx-auto flex min-h-[calc(100svh-5rem)] w-full max-w-2xl flex-col justify-center px-4 pt-14 pb-10 sm:px-8 sm:pt-16 sm:pb-16"
            : "relative flex min-h-[calc(100svh-5rem)] w-full flex-col justify-center px-6 pt-4 pb-20 sm:px-12 lg:w-1/2"
        }
      >
        {setup ? (
          <>
            <Card className="relative gap-0 overflow-visible px-6 pt-14 pb-6 shadow-sm sm:px-8 sm:pt-14 sm:pb-8">
              <FlowerMark className="absolute -top-9 left-6 -rotate-12 text-7xl sm:left-8" />
              {children}
            </Card>
            {progress}
          </>
        ) : (
          <div className="mx-auto w-full max-w-sm">{children}</div>
        )}
      </main>
      {!setup && (
        <div
          className="first-run-art absolute inset-y-3 right-3 hidden w-[calc(50%-0.75rem)] items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-canvas lg:flex"
          aria-hidden="true"
        >
          <div className="first-run-art-orbit" />
          <FlowerMark className="relative -rotate-12 text-[clamp(10rem,23vw,25rem)]" />
        </div>
      )}
    </div>
  );
}
