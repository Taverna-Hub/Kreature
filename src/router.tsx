import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import {
  AppShell,
  InstitutionsPage,
  InvestmentsPage,
  LaunchesPage,
  PlanningPage,
  ProfilePage,
  SummaryPage,
} from "@/App";

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
