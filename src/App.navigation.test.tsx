import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FinanceProvider } from "@/data/finance-context";
import { MemoryFinanceRepository } from "@/data/repository";
import { emptyFinanceState } from "@/domain/defaults";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props}>{children}</a>,
  Outlet: () => <div>Conteúdo</div>,
  useRouterState: () => "/resumo",
}));

import { AppShell } from "@/app/AppShell";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
});

describe("navegação móvel", () => {
  it("mantém atalhos essenciais e o novo lançamento acessível na barra inferior", async () => {
    const state = emptyFinanceState();
    render(<FinanceProvider repository={new MemoryFinanceRepository(state)}><AppShell /></FinanceProvider>);
    expect(await screen.findByRole("navigation", { name: "Navegação móvel" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Novo lançamento" })).toBeInTheDocument();
  });
});
