import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { FinanceProvider } from "@/data/finance-context";
import { router } from "@/router";
import "@/tailwind.css";
import "@/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FinanceProvider>
      <RouterProvider router={router} />
    </FinanceProvider>
  </StrictMode>,
);
