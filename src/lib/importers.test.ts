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

  it("reconhece o prefixo NU do CSV Nubank antes de bancos citados nas transações", async () => {
    const state = emptyFinanceState();
    const csv = [
      "Data,Valor,Identificador,Descrição",
      "29/01/2026,-200.00,uuid-1,Transferência enviada pelo Pix - Pessoa - Banco Inter",
      "30/01/2026,-30.00,uuid-2,Transferência enviada pelo Pix - Outra pessoa",
    ].join("\n");
    const result = await analyzeFile(new File([csv], "NU_000000000_01JAN2026_31JAN2026.csv", { type: "text/csv" }), state);

    expect(result.institutionHint).toBe("nubank");
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ detectedInstitutionId: "nubank" }),
    ]));
  });

  it("reconhece CSV de cartão pelo conteúdo e nunca pelo nome", async () => {
    const state = emptyFinanceState();
    const csv = "date,title,amount\n2026-04-25,Estorno de Loja,- 47,99\n2026-04-01,Loja - Parcela 1/2,52,65\n2026-04-07,Pagamento recebido,- 80,00";
    const result = await analyzeFile(new File([csv], "arquivo-qualquer.csv", { type: "text/csv" }), state);
    expect(result.institutionHint).toBe("nubank");
    expect(result.document).toMatchObject({ kind: "card_statement", requiresCard: true });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "card_refund", cardTransactionKind: "refund" }),
      expect.objectContaining({ kind: "card_purchase", installmentNumber: 1, totalInstallments: 2 }),
      expect.objectContaining({ kind: "credit_payment" }),
    ]));
  });

  it("categoriza compras do cartão usando o fluxo de despesa", async () => {
    const state = emptyFinanceState();
    const csv = [
      "date,title,amount",
      "2026-04-02,Uber viagem,25.90",
      "2026-04-20,Pagamento recebido,-25.90",
    ].join("\n");
    const result = await analyzeFile(new File([csv], "Nubank_2026.csv", { type: "text/csv" }), state);
    const transport = state.categories.find((category) => category.name === "Transporte");

    expect(result.candidates.find((candidate) => candidate.description === "Uber viagem")).toMatchObject({
      kind: "card_purchase",
      categoryId: transport?.id,
      suggestedCategoryId: transport?.id,
    });
  });

  it("respeita categorias fornecidas no CSV otimizado", async () => {
    const state = emptyFinanceState();
    const accountCsv = "Data,Valor,Identificador,Descrição,Categoria\n10/01/2026,-20.00,id-1,Estabelecimento genérico,Lazer";
    const cardCsv = [
      "date,title,amount,category",
      "2026-04-02,Compra genérica,25.90,Compras",
      "2026-04-20,Pagamento recebido,-25.90,",
    ].join("\n");
    const account = await analyzeFile(new File([accountCsv], "NU_CONSOLIDADO.csv", { type: "text/csv" }), state);
    const card = await analyzeFile(new File([cardCsv], "Nubank_2026.csv", { type: "text/csv" }), state);

    expect(account.candidates[0].categoryId).toBe(state.categories.find((category) => category.name === "Lazer")?.id);
    expect(card.candidates[0].categoryId).toBe(state.categories.find((category) => category.name === "Compras")?.id);
  });
});
