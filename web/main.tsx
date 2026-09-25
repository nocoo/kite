import { AccentProvider } from "@nocoo/basalt/providers/accent";
import "@nocoo/basalt/styles/standalone";
import "./style.css";
import { ThemeProvider, TooltipProvider } from "@nocoo/basalt";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Observatory } from "./view-model.ts";

const observatory = new Observatory();
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="kite-theme">
      <AccentProvider defaultAccent="primary" storageKey="kite-accent">
        <TooltipProvider>
          <App vm={observatory} />
        </TooltipProvider>
      </AccentProvider>
    </ThemeProvider>
  </StrictMode>,
);
