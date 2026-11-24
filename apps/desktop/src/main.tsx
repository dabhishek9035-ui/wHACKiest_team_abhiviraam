// owner: M2
// purpose: React entry. Mounts the pet shell, which opens the composer or workspace.
// consumed by: Tauri webview

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PetWindow } from "./windows/PetWindow";
import "./app.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing root element");
}

createRoot(root).render(
  <StrictMode>
    <PetWindow />
  </StrictMode>,
);
