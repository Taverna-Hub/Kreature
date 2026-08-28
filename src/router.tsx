import { lazy, Suspense, type ComponentType } from "react";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/app/AppShell";

function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const LazyPage = lazy(load);
  return function RoutePage() {
    return <Suspense fallback={<div className="page-route-loading" aria-live="polite">Carregando página…</div>}><LazyPage /></Suspense>;
  };
}

const SummaryPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.SummaryPage })));
const LaunchesPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.LaunchesPage })));
const InstitutionsPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.InstitutionsPage })));
const InvestmentsPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.InvestmentsPage })));
const PlanningPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.PlanningPage })));
const ProfilePage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.ProfilePage })));

const root = createRootRoute({ component: AppShell });
const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/resumo" });
  },
});
const summary = createRoute({
  getParentRoute: () => root,
  path: "/resumo",
  component: SummaryPage,
});
const launches = createRoute({
  getParentRoute: () => root,
  path: "/lancamentos",
  component: LaunchesPage,
});
const institutions = createRoute({
  getParentRoute: () => root,
  path: "/patrimonio/instituicoes",
  component: InstitutionsPage,
});
const investments = createRoute({
  getParentRoute: () => root,
  path: "/patrimonio/investimentos",
  component: InvestmentsPage,
});
const planning = createRoute({
  getParentRoute: () => root,
  path: "/planejamento",
  component: PlanningPage,
});
const profile = createRoute({
  getParentRoute: () => root,
  path: "/perfil",
  component: ProfilePage,
});
const routeTree = root.addChildren([
  index,
  summary,
  launches,
  institutions,
  investments,
  planning,
  profile,
]);
export const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
