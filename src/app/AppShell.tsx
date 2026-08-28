import { useEffect } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  CircleDollarSign,
  PiggyBank,
  Plus,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useFinance } from "@/data/finance-context";
import { Mascot } from "@/features/profile/Mascot";

const navigationItems = [
  ["/resumo", "Resumo", CircleDollarSign],
  ["/lancamentos", "Lançamentos", WalletCards],
  ["/patrimonio/instituicoes", "Patrimônio", PiggyBank],
  ["/planejamento", "Planejamento", CalendarDays],
  ["/perfil", "Perfil", UserRound],
] as const;

function ProfileAvatar() {
  const { state } = useFinance();

  return (
    <span className="nav-profile-avatar" aria-hidden="true">
      <Mascot config={state.profile} size={30} animated={false} />
    </span>
  );
}

export function AppShell() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { state, loading, error } = useFinance();

  useEffect(() => {
    const selected = state.theme ?? "light";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const theme = selected === "system" ? (media.matches ? "dark" : "light") : selected;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        "content",
        theme === "dark" ? "#18181b" : "#fffaf5",
      );
    };

    applyTheme();
    if (selected === "system") media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [state.theme]);

  const isCurrentRoute = (to: string) =>
    to === "/patrimonio/instituicoes"
      ? path.startsWith("/patrimonio")
      : path === to || path.startsWith(`${to}/`);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/resumo" className="brand">
          <span className="brand-avatar" aria-label="Logo Kreature">
            <img src="/favicon.svg" alt="" />
          </span>
          <span>
            <strong>Kreature</strong>
            <small>Seu dinheiro, do seu jeito</small>
          </span>
        </Link>
        <nav aria-label="Navegação principal">
          {navigationItems.map(([to, label, Icon]) => {
            const active = isCurrentRoute(to);
            return (
              <Link
                key={to}
                to={to}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
                {to === "/perfil" ? <ProfileAvatar /> : <Icon size={18} />}
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <nav className="mobile-nav" aria-label="Navegação móvel">
        <Link to="/resumo" className={isCurrentRoute("/resumo") ? "active" : ""} aria-current={isCurrentRoute("/resumo") ? "page" : undefined} aria-label="Resumo">
          <CircleDollarSign />
          <span>Resumo</span>
        </Link>
        <Link to="/patrimonio/instituicoes" className={isCurrentRoute("/patrimonio/instituicoes") ? "active" : ""} aria-current={isCurrentRoute("/patrimonio/instituicoes") ? "page" : undefined} aria-label="Patrimônio">
          <PiggyBank />
          <span>Patrimônio</span>
        </Link>
        <Link to="/lancamentos" className="mobile-add" aria-label="Novo lançamento">
          <Plus />
          <span>Novo</span>
        </Link>
        <Link to="/planejamento" className={isCurrentRoute("/planejamento") ? "active" : ""} aria-current={isCurrentRoute("/planejamento") ? "page" : undefined} aria-label="Planejamento">
          <CalendarDays />
          <span>Plano</span>
        </Link>
        <Link to="/perfil" className={isCurrentRoute("/perfil") ? "active" : ""} aria-current={isCurrentRoute("/perfil") ? "page" : undefined} aria-label="Perfil">
          <ProfileAvatar />
          <span>Perfil</span>
        </Link>
      </nav>

      {error ? <div className="global-error" role="alert">{error}</div> : null}
      {loading ? (
        <div className="loading" aria-live="polite">
          <span className="brand-mark"><span /></span>
          <p>Organizando suas finanças...</p>
        </div>
      ) : <Outlet />}
    </div>
  );
}
