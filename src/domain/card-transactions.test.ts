import { describe, expect, it } from "vitest";
import { attachCardPurchase, cardInvoices, recordCardPurchase, removeCardPurchase, updateCardPurchase } from "./cards";
import { emptyFinanceState } from "./defaults";
import { recordEntry, updateEntry } from "./ledger";
import type { CreditCard } from "./types";

const card = (id: string, payerInstitutionId?: string): CreditCard => ({
  id, name: id, issuer: "other", lastFour: "1234", network: "visa", cardType: "credit", cardholderName: "Teste",
  payerInstitutionId, limit: "5000", closingDay: 10, dueDay: 20, currency: "BRL", createdAt: "2026-01-01", updatedAt: "2026-01-01",
});

describe("transações de cartão", () => {
  it("converte uma despesa existente sem criar outro lançamento", () => {
    const state = emptyFinanceState();
    const firstCard = card("card-1");
    state.creditCards.push(firstCard);
    const entry = recordEntry(state, { date: "2026-08-15", description: "Mercado", amount: "100", currency: "BRL", kind: "expense" });
    const movementId = entry.financialMovementId;

    const updated = updateEntry(state, entry.id, {
      date: entry.date, description: entry.description, amount: "100", currency: "BRL", kind: "card_purchase",
      categoryId: entry.categoryId, creditCardId: firstCard.id, paymentMethod: "credit_card",
    });
    attachCardPurchase(state, updated.id, { cardId: firstCard.id, description: updated.description, amount: "100", currency: "BRL", date: updated.date, installments: 1 });

    expect(state.entries).toHaveLength(1);
    expect(state.financialMovements).toHaveLength(1);
    expect(state.entries[0].id).toBe(entry.id);
    expect(state.entries[0].financialMovementId).toBe(movementId);
    expect(state.financialMovements[0].paymentMethod).toBe("credit_card");
    expect(state.entries[0].institutionId).toBeUndefined();
    expect(state.cardPurchases).toHaveLength(1);
    expect(state.cardPurchases[0].ledgerEntryId).toBe(entry.id);
    expect(cardInvoices(state, firstCard.id)[0].installments[0].purchaseId).toBe(state.cardPurchases[0].id);
  });

  it("troca o cartão na mesma compra e permite voltar para uma conta", () => {
    const state = emptyFinanceState();
    const firstCard = card("card-1");
    const secondCard = card("card-2");
    const account = { id: "account-1", name: "Conta", type: "bank" as const, currency: "BRL", openingBalance: "1000", exchangeRate: "1", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    state.creditCards.push(firstCard, secondCard);
    state.institutions.push(account);
    const purchase = recordCardPurchase(state, { cardId: firstCard.id, description: "Compra", amount: "50", currency: "BRL", date: "2026-08-15", installments: 1 });
    const entry = state.entries.find((item) => item.id === purchase.ledgerEntryId)!;
    const movementId = entry.financialMovementId;

    updateCardPurchase(state, entry.id, { cardId: secondCard.id, description: "Compra", amount: "50", currency: "BRL", date: "2026-08-15", installments: 1 });
    expect(state.cardPurchases[0].cardId).toBe(secondCard.id);
    expect(state.entries).toHaveLength(1);

    updateEntry(state, entry.id, { date: entry.date, description: entry.description, amount: "50", currency: "BRL", kind: "expense", institutionId: account.id, paymentMethod: "pix" });
    removeCardPurchase(state, entry.id);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].financialMovementId).toBe(movementId);
    expect(state.entries[0].institutionId).toBe(account.id);
    expect(state.cardPurchases).toHaveLength(0);
  });
});
