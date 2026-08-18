import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./index.css";
import App from "./App.tsx";
import { Toaster } from "@/components/ui/sonner";
import { initializeQueuePersistence } from "@/lib/queue";
import "@/i18n";
async function bootstrap() {
    try {
        await initializeQueuePersistence();
    }
    catch (err) {
        console.error("Failed to initialize queue persistence:", err);
    }
    createRoot(document.getElementById("root")!).render(<StrictMode>
        <MotionConfig reducedMotion="user">
          <App />
          <Toaster position="bottom-left" duration={1000}/>
        </MotionConfig>
      </StrictMode>);
}
void bootstrap();
