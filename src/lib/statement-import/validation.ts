import Decimal from "decimal.js";
import type { StatementPageResult, StatementProgress } from "./types";

export type StatementValidation = {
  status: "ok" | "warning" | "unavailable";
  message: string;
  expectedBalance?: string;
  closingBalance?: string;
  basis?: "statement-totals" | "extracted-transactions";
};

export function validateStatementBalances(
  pages: StatementPageResult[],
  onProgress?: (progress: StatementProgress) => void,
): StatementValidation {
  onProgress?.({ stage: "validating", message: "Validando saldos do extrato" });
  const metadata = pages.map((page) => page.metadata);
  const opening = metadata.find((item) => item.openingBalance)?.openingBalance;
  const closing = [...metadata].reverse().find((item) => item.closingBalance)?.closingBalance;
  const statedCredits = metadata.find((item) => item.totalCredits)?.totalCredits;
  const statedDebits = metadata.find((item) => item.totalDebits)?.totalDebits;
  const transactions = pages.flatMap((page) => page.transactions);
  if (opening === undefined || closing === undefined || (!transactions.length && (statedCredits === undefined || statedDebits === undefined))) {
    return { status: "unavailable", message: "O extrato não informou todos os saldos e totais necessários para validação." };
  }
  const basis = statedCredits !== undefined && statedDebits !== undefined ? "statement-totals" : "extracted-transactions";
  const credits = statedCredits ?? transactions.reduce((sum, item) => item.direction === "credit" ? sum.plus(item.amount) : sum, new Decimal(0)).toString();
  const debits = statedDebits ?? transactions.reduce((sum, item) => item.direction === "debit" ? sum.plus(new Decimal(item.amount).abs()) : sum, new Decimal(0)).toString();
  const expected = new Decimal(opening).plus(credits).minus(debits);
  const difference = expected.minus(closing).abs();
  if (difference.lte("0.01")) {
    return { status: "ok", message: basis === "statement-totals" ? "Saldos e totais do extrato conferem." : "As movimentações identificadas conferem com os saldos do extrato.", expectedBalance: expected.toString(), closingBalance: closing, basis };
  }
  return {
    status: "warning",
    message: "Os saldos do extrato não fecharam. Revise as movimentações destacadas antes de importar.",
    expectedBalance: expected.toString(),
    closingBalance: closing,
    basis,
  };
}
