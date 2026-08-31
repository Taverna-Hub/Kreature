import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyFinanceState } from "@/domain/defaults";
import { recordCardPurchase } from "@/domain/cards";
import { recordEntry } from "@/domain/ledger";
import type { CreditCard } from "@/domain/types";
import { FeedbackProvider } from "@/shared/ui/FeedbackProvider";

const financeMock = vi.hoisted(() => ({ useFinance: vi.fn() }));
vi.mock("@/data/finance-context", () => ({ useFinance: financeMock.useFinance }));

import { LaunchesPage } from "./FinancePages";

describe("edição de compra do cartão", () => {
  it("atualiza a compra existente sem duplicar a operação ao adicionar categoria", async () => {
    const state = emptyFinanceState();
    const card: CreditCard = {
      id: "card-1",
      name: "Cartão principal",
      issuer: "other",
      limit: "5000",
      closingDay: 10,
      dueDay: 20,
      currency: "BRL",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    state.creditCards.push(card);
    recordCardPurchase(state, {
      cardId: card.id,
      description: "Compra mercado",
      amount: "100",
      currency: "BRL",
      date: "2026-08-15",
      categoryId: undefined,
      installments: 1,
    });
    financeMock.useFinance.mockReturnValue({
      state,
      commit: vi.fn(async (change: (draft: typeof state) => void) => change(state)),
    });

    render(<FeedbackProvider><LaunchesPage /></FeedbackProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));
    fireEvent.click(screen.getByRole("option", { name: /Alimenta/ }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar/ }));

    await waitFor(() => {
      expect(state.cardPurchases).toHaveLength(1);
      expect(state.entries).toHaveLength(1);
      expect(state.financialMovements).toHaveLength(1);
    });
    expect(state.cardPurchases[0].categoryId).toBe("default-expense-2");
    expect(state.entries[0].categoryId).toBe("default-expense-2");

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    fireEvent.click(screen.getByRole("button", { name: /Excluir lan/ }));
    await waitFor(() => {
      expect(state.cardPurchases).toHaveLength(0);
      expect(state.entries).toHaveLength(0);
      expect(state.financialMovements).toHaveLength(0);
    });
  });

  it("converte uma despesa existente para cartão mantendo seus IDs", async () => {
    const state = emptyFinanceState();
    const card: CreditCard = {
      id: "card-conversion",
      name: "Cartão principal",
      issuer: "other",
      cardType: "credit",
      limit: "5000",
      closingDay: 10,
      dueDay: 20,
      currency: "BRL",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    state.creditCards.push(card);
    const account = { id: "account-1", name: "Conta", type: "bank" as const, currency: "BRL", openingBalance: "1000", exchangeRate: "1", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" };
    state.institutions.push(account);
    const entry = recordEntry(state, { date: "2026-08-15", description: "Compra avulsa", amount: "80", currency: "BRL", kind: "expense", institutionId: account.id, paymentMethod: "pix" });
    const movementId = entry.financialMovementId;
    financeMock.useFinance.mockReturnValue({
      state,
      commit: vi.fn(async (change: (draft: typeof state) => void) => change(state)),
    });

    render(<FeedbackProvider><LaunchesPage /></FeedbackProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Forma de pagamento" }));
    fireEvent.click(screen.getByRole("option", { name: "Cartão de crédito" }));
    fireEvent.click(screen.getByRole("button", { name: "Cartão" }));
    fireEvent.click(screen.getByRole("option", { name: "Cartão principal" }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar/ }));

    await waitFor(() => expect(state.cardPurchases).toHaveLength(1));
    expect(state.entries).toHaveLength(1);
    expect(state.financialMovements).toHaveLength(1);
    expect(state.entries[0].id).toBe(entry.id);
    expect(state.entries[0].financialMovementId).toBe(movementId);
    expect(state.entries[0].institutionId).toBeUndefined();
    expect(state.entries[0].creditCardId).toBe(card.id);
  });
});
