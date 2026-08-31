import { lazy, Suspense, type ComponentType } from "react";
import { createRootRoute, createRoute, createRouter, redirect, Outlet } from "@tanstack/react-router";
import { AppShell, LoadingScreen } from "@/app/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { AuthCallbackPage } from "@/features/auth/AuthCallbackPage";

function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const LazyPage = lazy(load);
  return function RoutePage() {
    return <Suspense fallback={<LoadingScreen />}><LazyPage /></Suspense>;
  };
}

const SummaryPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.SummaryPage })));
const LaunchesPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.LaunchesPage })));
const InstitutionsPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.InstitutionsPage })));
const InvestmentsPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.InvestmentsPage })));
const PlanningPage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.PlanningPage })));
const ProfilePage = lazyPage(() => import("@/features/finance/FinancePages").then((module) => ({ default: module.ProfilePage })));

const root = createRootRoute({ component: Outlet });
const login = createRoute({
  getParentRoute: () => root,
  path: "/login",
  component: LoginPage,
});
const resetPassword = createRoute({ getParentRoute: () => root, path: "/redefinir-senha", component: ResetPasswordPage });
const authCallback = createRoute({ getParentRoute: () => root, path: "/auth/callback", component: AuthCallbackPage });
const authenticated = createRoute({
  getParentRoute: () => root,
  id: "authenticated",
  component: AppShell,
});
const index = createRoute({
  getParentRoute: () => authenticated,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/resumo" });
  },
});
const summary = createRoute({
  getParentRoute: () => authenticated,
  path: "/resumo",
  component: SummaryPage,
});
const launches = createRoute({
  getParentRoute: () => authenticated,
  path: "/lancamentos",
  component: LaunchesPage,
});
const institutions = createRoute({
  getParentRoute: () => authenticated,
  path: "/patrimonio/instituicoes",
  component: InstitutionsPage,
});
const investments = createRoute({
  getParentRoute: () => authenticated,
  path: "/patrimonio/investimentos",
  component: InvestmentsPage,
});
const planning = createRoute({
  getParentRoute: () => authenticated,
  path: "/planejamento",
  component: PlanningPage,
});
const profile = createRoute({
  getParentRoute: () => authenticated,
  path: "/perfil",
  component: ProfilePage,
});
const routeTree = root.addChildren([
  login,
  resetPassword,
  authCallback,
  authenticated.addChildren([index, summary, launches, institutions, investments, planning, profile]),
]);
export const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
