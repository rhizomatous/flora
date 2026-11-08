import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@flora/florets/ai";

import { AIGallery } from "./gallery";

import "@flora/florets/styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("The AI gallery requires a root element.");
createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <AIGallery />
    </TooltipProvider>
  </StrictMode>,
);
