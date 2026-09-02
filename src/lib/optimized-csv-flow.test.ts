import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { findImportedStatementInvoicePayment, reconcileImportedInvoicePayment } from "@/domain/cards";
import { emptyFinanceState } from "@/domain/defaults";
import { analyzeFile } from "./importers";

const optimizedFixture = async (name: string) => {
  const path = resolve(process.cwd(), "extratos", "Faturas", "otimizados", name);
  const text = await readFile(path, "utf8");
  return new File([text], name, { type: "text/csv" });
};

describe("CSVs otimizados reais", () => {
  it("lê integralmente a fatura Nubank, preservando compras, estornos e quitações", async () => {
    const result = await analyzeFile(
      await optimizedFixture("Nubank_2026_FATURAS_SANITIZADA.csv"),
      emptyFinanceState(),
    );

    expect(result).toMatchObject({
      source: "cartao-csv",
      institutionHint: "nubank",
      document: { kind: "card_statement", requiresCard: true },
    });
    expect(result.candidates).toHaveLength(250);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "card_purchase" }),
      expect.objectContaining({ kind: "card_refund", cardTransactionKind: "refund" }),
      expect.objectContaining({ kind: "credit_payment" }),
    ]));
    expect(result.candidates.every((candidate) => candidate.date && candidate.description && candidate.amount !== "0")).toBe(true);
  });

  it("lê integralmente o extrato Nubank, mantém IDs externos e reduz metadados bancários", async () => {
    const result = await analyzeFile(
      await optimizedFixture("NU_CONSOLIDADO_EXTRATOS.csv"),
      emptyFinanceState(),
    );

    expect(result).toMatchObject({ source: "nubank-csv", institutionHint: "nubank", currency: "BRL" });
    expect(result.candidates).toHaveLength(271);
    expect(result.warnings).toEqual([]);
    expect(result.candidates.every((candidate) => candidate.externalId && candidate.date && candidate.description && candidate.amount !== "0")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.kind === "pix")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.kind === "transfer")).toBe(false);
    const pixDescriptions = result.candidates.filter((candidate) => candidate.kind === "pix").map((candidate) => candidate.description);
    expect(pixDescriptions.filter((description) => /\b(?:ag[eê]ncia|conta)\s*[:.]?\s*\d|\b(?:cpf|cnpj)\s*[:.]?\s*\d/i.test(description))).toHaveLength(0);
  });

  it("reconcilia somente um débito quando fatura e extrato trazem o mesmo pagamento", async () => {
    const [cardFile, statementFile] = await Promise.all([
      optimizedFixture("Nubank_2026_FATURAS_SANITIZADA.csv"),
      optimizedFixture("NU_CONSOLIDADO_EXTRATOS.csv"),
    ]);
    const [cardImport, statementImport] = await Promise.all([
      analyzeFile(cardFile, emptyFinanceState()),
      analyzeFile(statementFile, emptyFinanceState()),
    ]);
    const cardPayment = cardImport.candidates.find((candidate) => candidate.kind === "credit_payment");
    const statementPayment = statementImport.candidates.find((statement) =>
      /\b(?:fatura|cart[aã]o|card|credit)\b/i.test(statement.description)
      && cardImport.candidates.some((card) => card.kind === "credit_payment"
        && new Decimal(card.amount).abs().eq(new Decimal(statement.amount).abs())
        && Math.abs(Date.parse(card.date) - Date.parse(statement.date)) <= 3 * 86_400_000),
    );
    expect(cardPayment).toBeDefined();
    expect(statementPayment).toBeDefined();

    const state = emptyFinanceState();
    state.institutions.push({ id: "payer", name: "Conta pagadora", type: "bank", currency: "BRL", openingBalance: "0", exchangeRate: "1", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    state.creditCards.push({ id: "card", name: "Cartão", issuer: "nubank", cardType: "credit", network: "mastercard", payerInstitutionId: "payer", limit: "10000", closingDay: 20, dueDay: 28, currency: "BRL", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const settlement = reconcileImportedInvoicePayment(state, {
      cardId: "card", date: cardPayment!.date, amount: cardPayment!.amount, description: cardPayment!.description,
    });
    const reconciled = findImportedStatementInvoicePayment(state, {
      institutionId: "payer", date: statementPayment!.date, amount: statementPayment!.amount, currency: "BRL", description: statementPayment!.description,
    });

    expect(reconciled?.id).toBe(settlement.id);
    expect(state.entries.filter((entry) => entry.kind === "credit_payment")).toHaveLength(1);
  });
});
