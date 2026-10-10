import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/unbounded/600.css";
import "@fontsource/unbounded/800.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/800.css";
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
