import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FinanceProvider } from "@/data/finance-context";
import { MemoryFinanceRepository } from "@/data/repository";
import { emptyFinanceState } from "@/domain/defaults";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props}>{children}</a>,
  Outlet: () => <div>Conteúdo</div>,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) => select({ location: { pathname: "/perfil" } }),
}));

import { AppShell } from "@/app/AppShell";

Object.defineProperty(window, "matchMedia", { writable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });

describe("Navigation state", () => {
  it("marks the current desktop and mobile destinations as the current page", async () => {
    render(<FinanceProvider repository={new MemoryFinanceRepository(emptyFinanceState())}><AppShell /></FinanceProvider>);
    const profileLinks = await screen.findAllByRole("link", { name: "Perfil" });
    expect(profileLinks).toHaveLength(2);
    profileLinks.forEach((link) => expect(link).toHaveAttribute("aria-current", "page"));
  });
});
