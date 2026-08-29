import type { EntryKind } from "@/domain/types";

type CsvRow = { date: string; description: string; amount: string };
export type CardCsvClassification = { kind: EntryKind; cardTransactionKind?: "purchase" | "refund" | "fee" | "interest"; installmentNumber?: number; totalInstallments?: number };

export const contentHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
};

/** This is intentionally conservative: the filename is never an input. */
export function isLikelyCardCsv(headers: string[], rows: CsvRow[]) {
  const schema = ["date", "title", "amount"].every((field) => headers.includes(field));
  return schema && rows.some((row) => /\b(parcela\s+\d+\/\d+|pagamento recebido|estorno|nupay)\b/i.test(row.description));
}

export function classifyCardCsvRow(row: CsvRow): CardCsvClassification {
  const installment = row.description.match(/\bparcela\s+(\d+)\s*\/\s*(\d+)\b/i);
  const parts = installment ? { installmentNumber: Number(installment[1]), totalInstallments: Number(installment[2]) } : {};
  if (/\bestorno\b/i.test(row.description)) return { kind: "card_refund", cardTransactionKind: "refund", ...parts };
  if (/\b(pagamento recebido|pagamento da fatura)\b/i.test(row.description)) return { kind: "credit_payment" };
  if (/\b(juros|encargos)\b/i.test(row.description)) return { kind: "card_interest", cardTransactionKind: "interest" };
  if (/\b(tarifa|anuidade)\b/i.test(row.description)) return { kind: "card_fee", cardTransactionKind: "fee" };
  return { kind: "card_purchase", cardTransactionKind: "purchase", ...parts };
}
