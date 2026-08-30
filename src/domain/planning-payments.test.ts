import { describe, expect, it } from "vitest";
import { cardInvoices, payCardInvoice } from "./cards";
import { emptyFinanceState } from "./defaults";
import { institutionBalance } from "./ledger";
import { buildSummary } from "./queries";
import { editRecurrence, settleOccurrence } from "./recurrence";

const account = (id: string, openingBalance = "1000") => ({
  id, name: id, type: "bank" as const, currency: "BRL", openingBalance, exchangeRate: "1",
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
});
const card = (id: string, payerInstitutionId?: string) => ({
  id, name: id, issuer: "other" as const, lastFour: "1234", network: "visa" as const, cardholderName: "Teste",
  payerInstitutionId, limit: "5000", closingDay: 10, dueDay: 20, currency: "BRL",
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
});

describe("planned payment methods", () => {
  it("settles Pix on occurrence date exactly once", () => {
    const state = emptyFinanceState();
    state.institutions.push(account("bank"));
    state.plannedEntries.push({ id: "pix-plan", startDate: "2026-08-30", description: "Conta", amount: "100", kind: "expense", institutionId: "bank", paymentMethod: "pix", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const first = settleOccurrence(state, "pix-plan", "2026-08-30");
    const second = settleOccurrence(state, "pix-plan", "2026-08-30");
    expect(second.id).toBe(first.id);
    expect(first.date).toBe("2026-08-30");
    expect(institutionBalance(state, "bank")).toBe("900");
    expect(state.entries).toHaveLength(1);
  });

  it("settles a card charge without debiting the bank", () => {
    const state = emptyFinanceState();
    state.institutions.push(account("bank"));
    state.creditCards.push(card("card", "bank"));
    state.plannedEntries.push({ id: "card-plan", startDate: "2026-08-30", description: "Compra", amount: "120", kind: "expense", institutionId: "bank", paymentMethod: "credit_card", creditCardId: "card", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const entry = settleOccurrence(state, "card-plan", "2026-08-30");
    expect(entry.date).toBe("2026-08-30");
    expect(entry.institutionId).toBeUndefined();
    expect(institutionBalance(state, "bank")).toBe("1000");
    expect(cardInvoices(state, "card")[0]).toMatchObject({ total: "120", status: "open" });
  });

  it("pays an invoice without adding an aggregate expense or duplicate payment", () => {
    const state = emptyFinanceState();
    state.institutions.push(account("bank"));
    state.creditCards.push(card("card", "bank"));
    state.plannedEntries.push({ id: "card-plan-pay", startDate: "2026-08-30", description: "Compra", amount: "120", kind: "expense", institutionId: "bank", paymentMethod: "credit_card", creditCardId: "card", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    settleOccurrence(state, "card-plan-pay", "2026-08-30");
    const invoice = cardInvoices(state, "card")[0];
    const payment = payCardInvoice(state, { cardId: "card", invoiceKey: invoice.key, institutionId: "bank", date: "2026-08-30" });
    const repeated = payCardInvoice(state, { cardId: "card", invoiceKey: invoice.key, institutionId: "bank", date: "2026-08-30" });
    expect(repeated.id).toBe(payment.id);
    expect(institutionBalance(state, "bank")).toBe("880");
    expect(buildSummary(state, { mode: "all" }).expenses).toBe("120");
    expect(cardInvoices(state, "card")[0].status).toBe("paid");
    expect(state.entries.filter((entry) => entry.systemGenerated)).toHaveLength(1);
  });

  it("keeps charges, refunds, fees and interest with the correct invoice signs", () => {
    const state = emptyFinanceState();
    state.creditCards.push(card("card"));
    const common = { cardId: "card", currency: "BRL", date: "2026-08-30", categoryId: undefined, installments: 1, firstInvoiceKey: "card:2026-09", notes: undefined, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    state.cardPurchases.push(
      { ...common, id: "purchase", ledgerEntryId: "purchase-entry", description: "Compra", amount: "100", transactionKind: "purchase" },
      { ...common, id: "refund", ledgerEntryId: "refund-entry", description: "Estorno", amount: "20", transactionKind: "refund" },
      { ...common, id: "fee", ledgerEntryId: "fee-entry", description: "Tarifa", amount: "5", transactionKind: "fee" },
      { ...common, id: "interest", ledgerEntryId: "interest-entry", description: "Juros", amount: "2", transactionKind: "interest" },
    );
    expect(cardInvoices(state, "card")[0].total).toBe("87");
  });

  it("blocks editing a completed occurrence specifically", () => {
    const state = emptyFinanceState();
    state.institutions.push(account("bank"));
    state.plannedEntries.push({ id: "locked-plan", startDate: "2026-08-30", description: "Conta", amount: "10", kind: "expense", institutionId: "bank", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    settleOccurrence(state, "locked-plan", "2026-08-30");
    expect(() => editRecurrence(state, "locked-plan", "2026-08-30", { amount: "20" }, "one")).toThrow("concluída");
  });
});
