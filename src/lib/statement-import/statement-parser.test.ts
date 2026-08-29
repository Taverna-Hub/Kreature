import { describe, expect, it } from "vitest";
import { parseStatementDocument, parseStatementPage } from "./statement-parser";

describe("parser de extrato", () => {
  it("une linhas, respeita débito/crédito e ignora saldos", () => {
    const result = parseStatementPage({
      page: 1,
      source: "native",
      text: [
        "Extrato de 01/08/2026 a 31/08/2026",
        "Saldo anterior R$ 1.000,00",
        "15/08 PIX REALIZADO",
        "JOAO DA SILVA",
        "123,50 D",
        "16/08 PIX RECEBIDO",
        "MARIA OLIVEIRA",
        "1.234,56 C",
        "Saldo final R$ 2.111,06",
      ].join("\n"),
    });

    expect(result.transactions).toEqual([
      expect.objectContaining({ date: "2026-08-15", description: "PIX REALIZADO JOAO DA SILVA", amount: "-123.5", direction: "debit" }),
      expect.objectContaining({ date: "2026-08-16", description: "PIX RECEBIDO MARIA OLIVEIRA", amount: "1234.56", direction: "credit" }),
    ]);
    expect(result.metadata.openingBalance).toBe("1000");
    expect(result.metadata.closingBalance).toBe("2111.06");
  });

  it("marca valor sem direção como revisão, sem assumir despesa", () => {
    const result = parseStatementPage({ page: 1, source: "ocr", text: "28 AGO 2026\nLOJA TESTE\n99,90" });
    expect(result.transactions[0]).toMatchObject({ date: "2026-08-28", amount: "99.9", direction: "unknown", needsReview: true });
  });

  it("mantém uma movimentação quebrada entre duas páginas", () => {
    const result = parseStatementDocument([
      { page: 1, source: "native", text: "Extrato\n15/08/2026 PIX REALIZADO\nJOAO DA SILVA" },
      { page: 2, source: "ocr", text: "Extrato - continuação\n123,50 D\n16/08/2026 PIX RECEBIDO MARIA\n50,00 C", ocrConfidence: 88 },
    ]);
    expect(result.flatMap((page) => page.transactions)).toEqual([
      expect.objectContaining({ page: 1, description: "PIX REALIZADO JOAO DA SILVA", amount: "-123.5" }),
      expect.objectContaining({ page: 2, amount: "50" }),
    ]);
  });

  it("aceita data com hífen e ponto decimal sem alterar centavos", () => {
    const result = parseStatementPage({ page: 1, source: "native", text: "28-08-2026 PIX RECEBIDO TESTE 1234.56 C" });
    expect(result.transactions[0]).toMatchObject({ date: "2026-08-28", amount: "1234.56" });
  });

  it("rejeita uma data de calendário impossível", () => {
    const result = parseStatementPage({ page: 1, source: "native", text: "31/02/2026 PIX RECEBIDO TESTE 10,00 C" });
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});
