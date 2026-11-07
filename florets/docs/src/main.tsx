import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Guide } from "./guide";
import { TexturePreview } from "./texture-example";

import "./styles.css";

const search = new URLSearchParams(window.location.search);
if (search.has("texture")) {
  document.documentElement.classList.toggle("dark", search.get("theme") !== "light");
}

const root = document.querySelector("#root");
if (root === null) throw new Error("The component guide requires a #root element.");
createRoot(root).render(
  <StrictMode>{search.has("texture") ? <TexturePreview search={search} /> : <Guide />}</StrictMode>,
);
