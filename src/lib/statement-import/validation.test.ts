import { describe, expect, it } from "vitest";
import { validateStatementBalances } from "./validation";

describe("validação de saldo do extrato", () => {
  it("confere metadados financeiros fornecidos pelo documento", () => {
    expect(
      validateStatementBalances([
        { page: 1, source: "native", transactions: [], warnings: [], metadata: { openingBalance: "100", totalCredits: "50", totalDebits: "20", closingBalance: "130" } },
      ]).status,
    ).toBe("ok");
  });

  it("não certifica documentos que não trouxeram totais", () => {
    expect(validateStatementBalances([{ page: 1, source: "native", transactions: [], warnings: [], metadata: { openingBalance: "100" } }]).status).toBe("unavailable");
  });

  it("usa as movimentações extraídas quando há saldos, mas não totais", () => {
    const transaction = { page: 1, source: "native" as const, rawText: "", date: "2026-08-01", description: "Pix recebido", amount: "20", direction: "credit" as const, confidence: .9, needsReview: false, reviewReasons: [] };
    const result = validateStatementBalances([{ page: 1, source: "native", transactions: [transaction], warnings: [], metadata: { openingBalance: "100", closingBalance: "120" } }]);
    expect(result).toMatchObject({ status: "ok", basis: "extracted-transactions" });
  });
});
