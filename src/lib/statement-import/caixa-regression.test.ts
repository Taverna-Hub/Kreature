import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseStatementDocument } from "./statement-parser";
import { validateStatementBalances } from "./validation";

type CaixaRow = [date: string, history: string, value: string];

const firstPage: CaixaRow[] = [
  ["31/05/2026 - 11:04:57", "PIX ENVIADO Pessoa A", "64,10 D"],
  ["30/05/2026 - 19:31:49", "COMPRA CARTAO DEBITO Loja A", "35,90 D"],
  ["30/05/2026 - 13:12:58", "PIX RECEBIDO Pessoa B", "100,00 C"],
  ["28/05/2026 - 16:58:47", "PIX ENVIADO Pessoa A", "335,66 D"],
  ["28/05/2026 - 16:57:20", "ENVIO TRANSF INTERNET TEV Pessoa C", "350,00 D"],
  ["28/05/2026 - 16:50:48", "PIX RECEBIDO Pessoa D", "55,00 C"],
  ["28/05/2026 - 16:23:37", "PIX RECEBIDO Pessoa D", "700,00 C"],
  ["27/05/2026 - 22:38:50", "COMPRA CARTAO DEBITO Loja B", "4,00 D"],
  ["25/05/2026 - 05:39:42", "TARIFA TRANSF RECURSO E/I", "2,50 D"],
  ["25/05/2026 - 05:39:42", "TARIFA TRANSF RECURSO E/I", "2,50 D"],
  ["25/05/2026 - 05:39:42", "TARIFA TRANSF RECURSO E/I", "2,50 D"],
  ["24/05/2026 - 19:50:08", "COMPRA CARTAO DEBITO Loja C", "35,99 D"],
  ["23/05/2026 - 03:03:43", "CREDITO JUROS", "0,77 C"],
  ["23/05/2026 - 03:03:43", "CORRECAO MONETARIA", "0,21 C"],
  ["23/05/2026 - 03:03:43", "CREDITO JUROS", "0,35 C"],
  ["23/05/2026 - 03:03:43", "CORRECAO MONETARIA", "0,12 C"],
  ["22/05/2026 - 20:11:03", "COMPRA CARTAO DEBITO Loja D", "23,30 D"],
  ["15/05/2026 - 11:03:29", "PIX ENVIADO Pessoa A", "386,97 D"],
];

const secondPage: CaixaRow[] = [
  ["15/05/2026 - 11:01:37", "ENVIO TRANSF INTERNET TEV Pessoa C", "460,00 D"],
  ["15/05/2026 - 08:14:55", "PIX RECEBIDO Pessoa E", "1.000,00 C"],
  ["14/05/2026 - 19:20:11", "PIX ENVIADO Loja E", "75,03 D"],
  ["14/05/2026 - 14:00:50", "PIX RECEBIDO Pessoa F", "120,00 C"],
  ["14/05/2026 - 09:37:17", "COMPRA CARTAO DEBITO Loja F", "23,00 D"],
  ["10/05/2026 - 10:46:46", "COMPRA CARTAO DEBITO Loja G", "175,00 D"],
  ["05/05/2026 - 16:07:33", "PIX ENVIADO Pessoa A", "663,63 D"],
  ["05/05/2026 - 15:48:55", "PIX RECEBIDO Pessoa G", "620,00 C"],
  ["05/05/2026 - 14:55:53", "PIX RECEBIDO Pessoa D", "43,63 C"],
  ["03/05/2026 - 00:29:52", "PIX ENVIADO Pessoa A", "60,00 D"],
  ["03/05/2026 - 00:28:43", "PIX ENVIADO Pessoa A", "9,00 D"],
  ["03/05/2026 - 00:23:12", "PIX RECEBIDO Pessoa H", "9,00 C"],
  ["02/05/2026 - 21:18:44", "PIX RECEBIDO Pessoa F", "60,00 C"],
  ["02/05/2026 - 14:10:47", "PIX ENVIADO Pessoa A", "8,00 D"],
  ["02/05/2026 - 14:10:12", "PIX ENVIADO Pessoa A", "500,00 D"],
  ["02/05/2026 - 14:09:11", "ENVIO TRANSF INTERNET TEV Pessoa C", "500,00 D"],
  ["02/05/2026 - 11:38:41", "PIX RECEBIDO Pessoa I", "1.000,00 C"],
  ["02/05/2026 - 01:37:12", "PIX RECEBIDO Pessoa H", "8,00 C"],
];

const line = ([date, history, value]: CaixaRow) => `${date} 000000 ${history} ${value} 400,00 C`;

describe("regressão CAIXA — extrato por período", () => {
  it("preserva os 36 lançamentos, C/D, período e saldo; SALDO DIA não vira lançamento", () => {
    const pages = parseStatementDocument([
      {
        page: 1,
        source: "ocr",
        ocrConfidence: 85,
        text: [
          "CAIXA", "Extrato por período", "Histórico/Complemento", "Período dos lançamentos 01/05/2026 até 31/05/2026", "SALDO ANTERIOR R$ 400,00 C",
          "01/06/2026 - 00:00:00 000000 SALDO DIA 0,00 C 400,00 C",
          ...firstPage.map(line),
          "24/05/2026 - 00:00:00 000000 SALDO DIA 0,00 C 377,17 C",
        ].join("\n"),
      },
      { page: 2, source: "ocr", ocrConfidence: 85, text: ["CAIXA", ...secondPage.map(line), "02/05/2026 - 00:00:00 000000 SALDO DIA 0,00 C 400,00 C"].join("\n") },
    ]);
    const transactions = pages.flatMap((page) => page.transactions);
    const credits = transactions.filter((item) => item.direction === "credit");
    const debits = transactions.filter((item) => item.direction === "debit");
    expect(pages[0].metadata).toMatchObject({ periodStart: "2026-05-01", periodEnd: "2026-05-31", openingBalance: "400", closingBalance: "400" });
    expect(transactions).toHaveLength(36);
    expect(transactions.some((item) => /saldo dia/i.test(item.description))).toBe(false);
    expect(credits).toHaveLength(15);
    expect(debits).toHaveLength(21);
    expect(credits.reduce((sum, item) => sum.plus(item.amount), new Decimal(0)).toString()).toBe("3717.08");
    expect(debits.reduce((sum, item) => sum.plus(new Decimal(item.amount).abs()), new Decimal(0)).toString()).toBe("3717.08");
    expect(transactions.find((item) => item.date === "2026-05-05" && item.amount === "43.63")).toBeDefined();
    expect(transactions.find((item) => item.date === "2026-05-14" && item.amount === "-75.03")).toBeDefined();
    expect(validateStatementBalances(pages)).toMatchObject({ status: "ok", expectedBalance: "400", closingBalance: "400" });
  });
});
