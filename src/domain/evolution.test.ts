import { describe, expect, it } from "vitest";
import { emptyFinanceState } from "./defaults";
import { searchInstitutionCatalog } from "./institution-catalog";
import { cardInvoices, payCardInvoice, recordCardPurchase } from "./cards";
import { normalizeFinanceState, derivedInstitutionAssets } from "./patrimony";
import { buildSummary } from "./queries";

const bank = (id: string) => ({
  id,
  name: id,
  type: "bank" as const,
  currency: "BRL",
  openingBalance: "1000",
  exchangeRate: "1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});

describe("evolução compatível do domínio", () => {
  it("migra investimentos legados para ativos sem apagar o registro anterior", () => {
    const state = emptyFinanceState();
    state.investments.push({
      id: "old-cdb", type: "cdb", name: "CDB", quantity: "1", averagePrice: "100",
      investedAmount: "100", currentPrice: "110", currentValue: "110", dividends: "0",
      currency: "BRL", quoteStatus: "manual", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    const migrated = normalizeFinanceState({ ...state, assets: undefined });
    expect(migrated.assets).toEqual([expect.objectContaining({ id: "old-cdb", kind: "traded", currentValue: "110" })]);
    expect(migrated.investments).toHaveLength(1);
  });

  it("expõe contas como ativos derivados, sem duplicar estado persistido", () => {
    const state = emptyFinanceState();
    state.institutions.push(bank("conta"));
    expect(derivedInstitutionAssets(state)).toEqual([expect.objectContaining({ id: "institution:conta", currentValue: "1000" })]);
    expect(state.assets).toHaveLength(0);
  });

  it("pesquisa o catálogo ignorando acentos e preenche metadados bancários", () => {
    const [itau] = searchInstitutionCatalog("itau");
    expect(itau).toMatchObject({ id: "itau", name: "Itaú", type: "bank", bankCode: "341" });
    expect(searchInstitutionCatalog("mercado")[0]?.id).toBe("mercado-pago");
  });
});

describe("cartão e fatura", () => {
  it("contabiliza a compra uma vez e torna o pagamento da fatura idempotente", () => {
    const state = emptyFinanceState();
    state.institutions.push(bank("bank"));
    state.creditCards.push({
      id: "card", name: "Kreature Card", limit: "5000", closingDay: 10, dueDay: 20,
      currency: "BRL", payerInstitutionId: "bank", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    const purchase = recordCardPurchase(state, {
      cardId: "card", description: "Notebook", amount: "300", currency: "BRL", date: "2026-01-11", installments: 3,
    });
    const invoices = cardInvoices(state, "card");
    expect(invoices).toHaveLength(3);
    expect(invoices.map((item) => item.total)).toEqual(["100", "100", "100"]);
    expect(buildSummary(state, { mode: "all" }).expenses).toBe("300");
    const paid = payCardInvoice(state, { cardId: "card", invoiceKey: invoices[0].key, institutionId: "bank", date: "2026-02-20" });
    expect(payCardInvoice(state, { cardId: "card", invoiceKey: invoices[0].key, institutionId: "bank", date: "2026-02-20" }).id).toBe(paid.id);
    expect(state.entries.filter((item) => item.kind === "credit_payment")).toHaveLength(1);
    expect(purchase.ledgerEntryId).toBeTruthy();
    expect(buildSummary(state, { mode: "all" }).expenses).toBe("300");
  });
});
