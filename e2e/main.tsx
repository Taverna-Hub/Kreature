import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "@/router";
import { FinanceProvider } from "@/data/finance-context";
import { MemoryFinanceRepository } from "@/data/repository";
import { emptyFinanceState } from "@/domain/defaults";
import { FeedbackProvider } from "@/shared/ui/FeedbackProvider";
import "@/app/styles.css";
const state = emptyFinanceState();
state.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
state.profile.nickname = "kreature";
state.profile.bio = "Meu dinheiro, do meu jeito.";
const stamp = "2026-09-13T15:00:00Z";
state.institutions.push({ id: "bank", name: "Conta principal", type: "bank", currency: "BRL", openingBalance: "15032.34", exchangeRate: "1", createdAt: stamp, updatedAt: stamp });
state.entries = Array.from({ length: 36 }, (_, i) => ({
  id: `entry-${i}`, date: i < 30 ? "2026-09-13" : ["2026-09-20", "2026-10-13", "2026-11-13", "2026-08-13", "2026-09-14", "2026-12-13"][i - 30],
  description: `Compra ${i} com descrição extensa para testar a prioridade do nome`,
  amount: i === 0 ? "-12500000.45" : "-532.45", brlAmount: "-532.45", currency: "BRL", kind: "expense" as const,
  institutionId: "bank", categoryId: state.categories[0].id, source: "manual" as const, ignoredFromAnalytics: false, createdAt: stamp, updatedAt: stamp,
}));
state.plannedEntries.push({ id: "plan", description: "Mensalidade planejada", amount: "532.45", currency: "BRL", kind: "expense", exceptions: [], frequency: "monthly", startDate: "2026-09-20", categoryId: state.categories[0].id, institutionId: "bank",  createdAt: stamp, updatedAt: stamp });
const repository = new MemoryFinanceRepository(state);
createRoot(document.getElementById("root")!).render(<FinanceProvider repository={repository}><FeedbackProvider><RouterProvider router={router} /></FeedbackProvider></FinanceProvider>);
