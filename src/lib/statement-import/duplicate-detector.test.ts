import { describe, expect, it } from "vitest";
import { emptyFinanceState } from "@/domain/defaults";
import { detectImportDuplicate } from "./duplicate-detector";

describe("duplicatas de importação", () => {
  it("considera conta, data, valor, descrição e tipo", () => {
    const state = emptyFinanceState();
    state.institutions.push({ id: "nu", name: "Nubank", type: "bank", currency: "BRL", openingBalance: "0", exchangeRate: "1", catalogId: "nubank", createdAt: "", updatedAt: "" });
    state.entries.push({ id: "entry", date: "2026-08-15", description: "Pix enviado Loja", amount: "-10", brlAmount: "-10", currency: "BRL", kind: "pix", source: "import", institutionId: "nu", ignoredFromAnalytics: false, createdAt: "", updatedAt: "" });
    expect(detectImportDuplicate(state, { date: "2026-08-15", description: "PIX ENVIADO LOJA", amount: "-10", kind: "pix", fingerprint: "new", institutionHint: "nubank" })).toEqual({ exact: true, possible: false });
    expect(detectImportDuplicate(state, { date: "2026-08-15", description: "Outra descrição", amount: "-10", kind: "expense", fingerprint: "other", institutionHint: "nubank" })).toEqual({ exact: false, possible: true });
  });
});
