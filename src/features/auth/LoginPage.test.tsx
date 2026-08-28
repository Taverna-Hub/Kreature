import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endLocalSession, getLocalSession } from "@/auth/session";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

import { LoginPage } from "./LoginPage";

afterEach(() => {
  endLocalSession();
  navigate.mockReset();
});

describe("LoginPage", () => {
  it("inicia a sessão local e segue para o resumo", () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Como podemos te chamar?"), { target: { value: "Thomaz" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar no Kreature" }));

    expect(getLocalSession()).toEqual({ name: "Thomaz" });
    expect(navigate).toHaveBeenCalledWith({ to: "/resumo" });
  });
});
