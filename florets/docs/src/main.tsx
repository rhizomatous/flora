import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Guide } from "./guide";

import "./styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("The component guide requires a #root element.");
createRoot(root).render(
  <StrictMode>
    <Guide />
  </StrictMode>,
);
