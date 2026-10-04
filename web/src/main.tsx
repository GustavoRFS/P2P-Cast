import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeTauriDesktopBridge } from "./lib/tauri-desktop";

async function startApp() {
    await initializeTauriDesktopBridge();
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}

void startApp();
