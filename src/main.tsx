import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { FinanceProvider } from "@/data/finance-context";
import { AuthProvider } from "@/auth/auth-context";
import { router } from "@/router";
import { FeedbackProvider } from "@/shared/ui/FeedbackProvider";
import "@/app/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <FinanceProvider>
        <FeedbackProvider>
          <RouterProvider router={router} />
        </FeedbackProvider>
      </FinanceProvider>
    </AuthProvider>
  </StrictMode>,
);
