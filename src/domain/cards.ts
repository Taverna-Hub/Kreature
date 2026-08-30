import Decimal from "decimal.js";
import { addMonths, format, parseISO } from "date-fns";
import { now, uid } from "./defaults";
import { recordEntry } from "./ledger";
import type { CardPurchase, CreditCard, FinanceState, LedgerEntry } from "./types";

export interface InvoiceInstallment {
  purchaseId: string;
  installment: number;
  totalInstallments: number;
  amount: string;
  dueDate: string;
  description: string;
  categoryId?: string;
}

export interface CardInvoice {
  key: string;
  cardId: string;
  closingDate: string;
  dueDate: string;
  total: string;
  installments: InvoiceInstallment[];
  paidEntryId?: string;
}

function cycleStart(date: Date, closingDay: number) {
  const candidate = new Date(date.getFullYear(), date.getMonth(), closingDay);
  return date.getDate() > closingDay ? addMonths(candidate, 1) : candidate;
}

export function invoiceKeyFor(card: Pick<CreditCard, "id" | "closingDay">, date: string) {
  const close = cycleStart(parseISO(date), card.closingDay);
  return `${card.id}:${format(close, "yyyy-MM")}`;
}

export function invoiceSchedule(card: CreditCard, purchase: CardPurchase): InvoiceInstallment[] {
  const firstClose = parseISO(purchase.firstInvoiceKey.split(":")[1] + "-01");
  const base = new Decimal(purchase.amount).div(purchase.installments);
  return Array.from({ length: purchase.installments }, (_, index) => {
    const close = addMonths(firstClose, index);
    const due = new Date(close.getFullYear(), close.getMonth(), Math.min(card.dueDay, new Date(close.getFullYear(), close.getMonth() + 1, 0).getDate()));
    const amount = index === purchase.installments - 1
      ? new Decimal(purchase.amount).minus(base.mul(purchase.installments - 1))
      : base;
    return {
      purchaseId: purchase.id,
      installment: index + 1,
      totalInstallments: purchase.installments,
      amount: amount.toDecimalPlaces(2).toString(),
      dueDate: format(due, "yyyy-MM-dd"),
      description: purchase.description,
      categoryId: purchase.categoryId,
    };
  });
}

export function cardInvoices(state: FinanceState, cardId: string): CardInvoice[] {
  const card = state.creditCards.find((item) => item.id === cardId);
  if (!card) throw new Error("Cartão não encontrado.");
  const groups = new Map<string, InvoiceInstallment[]>();
  state.cardPurchases.filter((purchase) => purchase.cardId === cardId && (purchase.transactionKind ?? "purchase") === "purchase").forEach((purchase) => {
    invoiceSchedule(card, purchase).forEach((installment, index) => {
      const key = `${card.id}:${format(addMonths(parseISO(purchase.firstInvoiceKey.split(":")[1] + "-01"), index), "yyyy-MM")}`;
      groups.set(key, [...(groups.get(key) ?? []), installment]);
    });
  });
  return [...groups.entries()].map(([key, installments]) => {
    const [year, month] = key.split(":")[1].split("-").map(Number);
    const closeDate = new Date(year, month - 1, card.closingDay);
    const dueDate = installments[0]?.dueDate ?? format(closeDate, "yyyy-MM-dd");
    return {
      key,
      cardId,
      closingDate: format(closeDate, "yyyy-MM-dd"),
      dueDate,
      total: installments.reduce((sum, item) => sum.plus(item.amount), new Decimal(0)).toString(),
      installments,
      paidEntryId: state.entries.find((entry) => entry.invoiceKey === key && entry.kind === "credit_payment")?.id,
    };
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function recordCardPurchase(
  state: FinanceState,
  input: Omit<CardPurchase, "id" | "createdAt" | "updatedAt" | "ledgerEntryId" | "firstInvoiceKey">,
) {
  const card = state.creditCards.find((item) => item.id === input.cardId && !item.archivedAt);
  if (!card) throw new Error("Selecione um cartão válido.");
  if (!Number.isInteger(input.installments) || input.installments < 1)
    throw new Error("Informe ao menos uma parcela.");
  const ledgerEntry = recordEntry(state, {
    date: input.date,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    kind: "card_purchase",
    categoryId: input.categoryId,
    creditCardId: card.id,
    ignoredFromAnalytics: false,
    notes: input.notes,
  });
  const timestamp = now();
  const purchase: CardPurchase = {
    ...input,
    transactionKind: "purchase",
    id: uid("card-purchase"),
    ledgerEntryId: ledgerEntry.id,
    firstInvoiceKey: invoiceKeyFor(card, input.date),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.cardPurchases.push(purchase);
  return purchase;
}

export function updateCardPurchase(
  state: FinanceState,
  ledgerEntryId: string,
  input: Pick<CardPurchase, "cardId" | "description" | "amount" | "currency" | "date" | "categoryId" | "installments" | "notes">,
) {
  const purchase = state.cardPurchases.find((item) => item.ledgerEntryId === ledgerEntryId);
  if (!purchase) return;
  const card = state.creditCards.find((item) => item.id === input.cardId && !item.archivedAt);
  if (!card) throw new Error("Selecione um cartão válido.");
  if (!Number.isInteger(input.installments) || input.installments < 1)
    throw new Error("Informe ao menos uma parcela.");
  Object.assign(purchase, {
    cardId: input.cardId,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    date: input.date,
    categoryId: input.categoryId,
    installments: input.installments,
    firstInvoiceKey: invoiceKeyFor(card, input.date),
    notes: input.notes,
    updatedAt: now(),
  });
}

export function payCardInvoice(
  state: FinanceState,
  input: { cardId: string; invoiceKey: string; institutionId: string; date: string; notes?: string },
): LedgerEntry {
  const invoice = cardInvoices(state, input.cardId).find((item) => item.key === input.invoiceKey);
  if (!invoice) throw new Error("Fatura não encontrada.");
  if (invoice.paidEntryId) return state.entries.find((entry) => entry.id === invoice.paidEntryId)!;
  const card = state.creditCards.find((item) => item.id === input.cardId)!;
  return recordEntry(state, {
    date: input.date,
    description: `Pagamento de fatura ${card.name}`,
    amount: invoice.total,
    currency: card.currency,
    kind: "credit_payment",
    institutionId: input.institutionId,
    creditCardId: card.id,
    invoiceKey: invoice.key,
    ignoredFromAnalytics: true,
    notes: input.notes,
  });
}
