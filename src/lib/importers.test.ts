import { describe, expect, it } from "vitest";
import { emptyFinanceState } from "@/domain/defaults";
import { analyzeFile, parseAmount } from "./importers";

describe("StatementImport", () => {
  it.each([
    ["R$ 1.234,56", "1234.56"],
    ["- 1.234,56", "-1234.56"],
    ["1.234,56-", "-1234.56"],
    ["1234,56 D", "-1234.56"],
    ["1234,56 C", "1234.56"],
  ])("interpreta o valor financeiro %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("analisa CSV, explica a classificação e marca uma reimportação", async () => {
    const state = emptyFinanceState();
    const csv = "data,descricao,valor\n10/01/2026,Mercado Central,-125.90";
    const first = await analyzeFile(new File([csv], "extrato.csv", { type: "text/csv" }), state);
    expect(first.candidates[0]).toMatchObject({
      date: "2026-01-10",
      kind: "expense",
      confidence: 0.86,
      duplicate: false,
    });
    state.entries.push({
      id: "existing",
      date: "2026-01-10",
      description: "Mercado Central",
      amount: "-125.9",
      brlAmount: "-125.9",
      currency: "BRL",
      kind: "expense",
      source: "import",
      ignoredFromAnalytics: false,
      fingerprint: first.candidates[0].fingerprint,
      createdAt: "2026-01-10",
      updatedAt: "2026-01-10",
    });
    const repeated = await analyzeFile(new File([csv], "extrato.csv", { type: "text/csv" }), state);
    expect(repeated.candidates[0].duplicate).toBe(true);
    expect(repeated.candidates[0].reason).toContain("Alimentação");
  });

  it("lê OFX, preserva identificador externo e identifica duplicidade", async () => {
    const state = emptyFinanceState();
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRN><DTPOSTED>20260715120000<TRNAMT>-12.50<FITID>abc-123<MEMO>PIX enviado mercado</STMTTRN><CURDEF>BRL</OFX>`;
    const result = await analyzeFile(new File([ofx], "conta.ofx", { type: "application/x-ofx" }), state);
    expect(result.candidates[0]).toMatchObject({ date: "2026-07-15", amount: "-12.5", externalId: "abc-123", kind: "expense", currency: "BRL" });
  });

  it("reconhece CSV Nubank e o identificador da operação", async () => {
    const state = emptyFinanceState();
    const csv = "Data,Valor,Identificador,Descrição\n01/05/2026,-52.50,uuid-1,Transferência enviada pelo Pix - Loja";
    const content = `${csv}\nNubank`;
    const result = await analyzeFile(new File([content], "arquivo.csv", { type: "text/csv" }), state);
    expect(result.institutionHint).toBe("nubank");
    expect(result.candidates[0]).toMatchObject({ externalId: "uuid-1", kind: "pix", description: "Pix enviado · Loja" });
  });

  it("reconhece CSV de cartão pelo conteúdo e nunca pelo nome", async () => {
    const state = emptyFinanceState();
    const csv = "date,title,amount\n2026-04-25,Estorno de Loja,- 47,99\n2026-04-01,Loja - Parcela 1/2,52,65\n2026-04-07,Pagamento recebido,- 80,00";
    const result = await analyzeFile(new File([csv], "arquivo-qualquer.csv", { type: "text/csv" }), state);
    expect(result.document).toMatchObject({ kind: "card_statement", requiresCard: true });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "card_refund", cardTransactionKind: "refund" }),
      expect.objectContaining({ kind: "card_purchase", installmentNumber: 1, totalInstallments: 2 }),
      expect.objectContaining({ kind: "credit_payment" }),
    ]));
  });
});
