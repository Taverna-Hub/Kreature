import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { FinanceProvider } from "@/data/finance-context";
import { router } from "@/router";
import { FeedbackProvider } from "@/shared/ui/FeedbackProvider";
import "@/app/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FinanceProvider>
      <FeedbackProvider>
        <RouterProvider router={router} />
      </FeedbackProvider>
    </FinanceProvider>
  </StrictMode>,
);
