import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyFinanceState } from "@/domain/defaults";
import { buildSummary } from "@/domain/queries";
import { FeedbackProvider } from "@/shared/ui/FeedbackProvider";

const financeMock = vi.hoisted(() => ({ useFinance: vi.fn() }));

vi.mock("@/data/finance-context", () => ({ useFinance: financeMock.useFinance }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useNavigate: () => vi.fn(),
}));

import { InvestmentsPage } from "./FinancePages";

describe("reserva em dinheiro", () => {
  it("permite cadastrar valor sem associar uma conta", async () => {
    const state = emptyFinanceState();
    financeMock.useFinance.mockReturnValue({
      state,
      commit: vi.fn(async (change: (draft: typeof state) => void) => change(state)),
    });
    render(<FeedbackProvider><InvestmentsPage /></FeedbackProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Novo investimento" }));
    fireEvent.click(screen.getByRole("button", { name: "Classe financeira" }));
    fireEvent.click(screen.getByRole("option", { name: "Reserva / dinheiro" }));

    expect(screen.getByRole("button", { name: "Instituição" })).toHaveTextContent("Dinheiro (sem conta associada)");
    fireEvent.change(screen.getByLabelText("Nome do ativo"), { target: { value: "Reserva de emergência" } });
    fireEvent.change(screen.getByLabelText("Preço médio"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Valor aplicado"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Preço atual"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Valor atual"), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar investimento" }));

    await waitFor(() => expect(state.investments).toHaveLength(1));
    expect(state.investments[0]).toMatchObject({
      name: "Reserva de emergência", type: "cash_box", institutionId: undefined, currentValue: "1500",
    });
    expect(screen.queryByText("Registrar aplicação e reduzir saldo disponível")).toBeNull();
  });

  it("guarda e permite corrigir a cotação de uma reserva em moeda estrangeira", async () => {
    const state = emptyFinanceState();
    financeMock.useFinance.mockReturnValue({
      state,
      commit: vi.fn(async (change: (draft: typeof state) => void) => change(state)),
    });
    render(<FeedbackProvider><InvestmentsPage /></FeedbackProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Novo investimento" }));
    fireEvent.click(screen.getByRole("button", { name: "Classe financeira" }));
    fireEvent.click(screen.getByRole("option", { name: "Reserva / dinheiro" }));
    fireEvent.change(screen.getByLabelText("Nome do ativo"), { target: { value: "Reserva em dólar" } });
    fireEvent.change(screen.getByLabelText("Moeda"), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("Preço médio"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Valor aplicado"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Preço atual"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Valor atual"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Cotação para BRL"), { target: { value: "5.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar investimento" }));

    await waitFor(() => expect(state.investments).toHaveLength(1));
    expect(state.investments[0]).toMatchObject({ currency: "USD", exchangeRate: "5.3" });
    expect(buildSummary(state, { mode: "all" }).invested).toBe("1060");
  });
});
