import { describe, expect, it } from "vitest";
import { emptyFinanceState } from "./defaults";
import { suggestInternalTransfer } from "./internal-transfers";

const account = (id: string) => ({ id, name: id, type: "bank" as const, currency: "BRL", openingBalance: "0", exchangeRate: "1", createdAt: "", updatedAt: "" });

describe("suggestInternalTransfer", () => {
  it("sugere apenas uma contraparte oposta e inequívoca", () => {
    const state = emptyFinanceState();
    state.institutions.push(account("Nubank"), account("Inter"));
    state.entries.push({ id: "in", date: "2026-08-10", description: "Pix recebido Nubank", amount: "500", brlAmount: "500", currency: "BRL", kind: "pix", institutionId: "Inter", source: "import", ignoredFromAnalytics: false, createdAt: "", updatedAt: "" });
    const result = suggestInternalTransfer(state, { id: "out", date: "2026-08-10", description: "Pix enviado Inter", amount: "-500", currency: "BRL", parser: "ofx", kind: "pix", suggestedKind: "pix", confidence: 1, reason: "", source: "ofx", include: true, createInvestment: false, fingerprint: "x", duplicate: false, institutionId: "Nubank" });
    expect(result).toMatchObject({ counterpartyInstitutionId: "Inter", internalTransferSuggestion: { confidence: 0.9 } });
  });

  it("não sugere quando há mais de uma contraparte possível", () => {
    const state = emptyFinanceState();
    state.institutions.push(account("Nubank"), account("Inter"), account("C6"));
    for (const id of ["Inter", "C6"]) state.entries.push({ id, date: "2026-08-10", description: "Pix recebido Nubank", amount: "500", brlAmount: "500", currency: "BRL", kind: "pix", institutionId: id, source: "import", ignoredFromAnalytics: false, createdAt: "", updatedAt: "" });
    const result = suggestInternalTransfer(state, { id: "out", date: "2026-08-10", description: "Pix enviado Inter C6", amount: "-500", currency: "BRL", parser: "ofx", kind: "pix", suggestedKind: "pix", confidence: 1, reason: "", source: "ofx", include: true, createInvestment: false, fingerprint: "x", duplicate: false, institutionId: "Nubank" });
    expect(result.internalTransferSuggestion).toBeUndefined();
  });

});
