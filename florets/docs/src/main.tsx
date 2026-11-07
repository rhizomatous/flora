import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Guide } from "./guide";
import { PhotoLab } from "./photo-lab";

import "./styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("The component guide requires a #root element.");
createRoot(root).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).has("photo-lab") ? <PhotoLab /> : <Guide />}
  </StrictMode>,
);
