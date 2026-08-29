import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const signIn = vi.fn().mockResolvedValue(undefined);
const signUp = vi.fn().mockResolvedValue(undefined);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => navigate,
}));
vi.mock("@/auth/auth-context", () => ({ useAuth: () => ({ signIn, signUp, status: "anonymous" }) }));

import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  navigate.mockReset();
  signIn.mockClear();
  signUp.mockClear();
});

describe("LoginPage", () => {
  it("envia credenciais ao Supabase e abre o resumo", async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "thomaz@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-segura" } });
    fireEvent.click(screen.getByRole("button", { name: /entrar no kreature/i }));
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledWith("thomaz@example.com", "senha-segura"));
    expect(navigate).toHaveBeenCalledWith({ to: "/resumo" });
  });

  it("permite criar uma conta sem persistir uma senha própria", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: /ainda não tenho conta/i }));
    fireEvent.change(screen.getByLabelText("Como podemos te chamar?"), { target: { value: "Thomaz" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "thomaz@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-segura" } });
    fireEvent.click(screen.getByRole("button", { name: /criar conta/i }));
    await vi.waitFor(() => expect(signUp).toHaveBeenCalledWith("Thomaz", "thomaz@example.com", "senha-segura"));
  });
});
