import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FlowerMark } from "@flora/florets";
import "@flora/florets/styles.css";

function App() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col px-6 py-10 sm:px-10">
      <header className="flex items-center gap-2 text-lg font-semibold">
        <FlowerMark />
        <span>Flora</span>
      </header>
      <section className="my-auto py-20" aria-labelledby="welcome">
        <p className="mb-4 text-sm text-muted-foreground">Self-hosted coding agent</p>
        <h1 id="welcome" className="text-3xl font-semibold tracking-tight">Room to grow.</h1>
        <p className="mt-5 max-w-prose text-base leading-7 text-muted-foreground">
          Flora’s application foundation is running. Project setup and persistent
          agent chats are coming next.
        </p>
      </section>
      <footer className="text-sm text-muted-foreground">Early development · Built to run on your own host</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
