import { lazy, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

import { Toaster, TooltipProvider } from "@flora/florets";

import "./styles.css";

const loaders = import.meta.glob<{ Preview: ComponentType }>("./examples/upstream/*.tsx");
const params = new URLSearchParams(location.search);
const name = params.get("component") ?? "button";
const dark = params.get("theme") !== "light";
document.documentElement.classList.toggle("dark", dark);
document.title = `Florets · ${name}`;
const load = loaders[`./examples/upstream/${name}.tsx`];
const Preview =
  load === undefined
    ? undefined
    : lazy(async () => {
        const module = await load();
        return { default: module.Preview };
      });
const root = document.querySelector("#root");
if (root === null) throw new Error("The component preview requires a root element.");
createRoot(root).render(
  <TooltipProvider>
    <Toaster theme={dark ? "dark" : "light"} />
    <Suspense
      fallback={
        <p role="status" className="p-6 text-sm">
          Loading examples…
        </p>
      }
    >
      {Preview === undefined ? (
        <p role="alert" className="p-6">
          Unknown component.
        </p>
      ) : (
        <Preview />
      )}
    </Suspense>
  </TooltipProvider>,
);
