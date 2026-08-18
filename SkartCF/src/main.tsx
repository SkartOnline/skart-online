// Shared styles first: each screen imports its own stylesheet, and the cascade
// only stays predictable if the shared vocabulary is injected before any of them.
import "./ui/fonts.css";
import "./ui/theme.css";
import "./ui/card/card.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
