import Decimal from "decimal.js";
import { now, uid } from "./defaults";
import { learnClassificationRule } from "./classification";
import type { CategoryFlow, FinanceState, LedgerEntry } from "./types";

export type EntryInput = Omit<
  LedgerEntry,
  "id" | "amount" | "brlAmount" | "createdAt" | "updatedAt" | "source" | "ignoredFromAnalytics"
> & {
  amount: string;
  brlRate?: string;
  source?: LedgerEntry["source"];
  ignoredFromAnalytics?: boolean;
};

const negativeKinds = new Set(["expense", "investment", "reserve", "credit_payment", "card_purchase"]);
/**
 * A categoria é a classificação mais específica que o usuário deu: uma categoria de despesa
 * nunca resulta em valor positivo, nem uma de receita em valor negativo. Sem categoria, o tipo
 * do lançamento decide — e tipos ambíguos (Pix, transferência, ajuste) mantêm o sinal informado.
 */
export const signedAmount = (kind: LedgerEntry["kind"], value: string, flow?: CategoryFlow) => {
  const decimal = new Decimal(value || 0);
  if (flow) return (flow === "expense" ? decimal.abs().negated() : decimal.abs()).toString();
  if (kind === "adjustment" || kind === "transfer" || kind === "pix") return decimal.toString();
  return (negativeKinds.has(kind) ? decimal.abs().negated() : decimal.abs()).toString();
};

const categoryFlow = (state: FinanceState, categoryId?: string): CategoryFlow | undefined =>
  categoryId ? state.categories.find((item) => item.id === categoryId)?.flow : undefined;

function buildEntry(input: EntryInput, id = uid("entry"), createdAt = now(), flow?: CategoryFlow): LedgerEntry {
  const amount = signedAmount(input.kind, input.amount, flow);
  const rate = new Decimal(input.brlRate ?? (input.currency === "BRL" ? 1 : 0));
  return {
    ...input,
    id,
    amount,
    brlAmount: new Decimal(amount).mul(rate).toString(),
    source: input.source ?? "manual",
    ignoredFromAnalytics:
      input.ignoredFromAnalytics ?? (input.kind === "transfer" || input.kind === "credit_payment"),
    createdAt,
    updatedAt: now(),
  };
}

export function recordEntry(state: FinanceState, input: EntryInput): LedgerEntry {
  if (
    input.institutionId &&
    !state.institutions.some((item) => item.id === input.institutionId && !item.archivedAt)
  )
    throw new Error("Instituição inválida ou arquivada.");
  if (
    input.categoryId &&
    !state.categories.some((item) => item.id === input.categoryId && !item.archivedAt)
  )
    throw new Error("Categoria inválida ou arquivada.");
  const entry = buildEntry(input, undefined, undefined, categoryFlow(state, input.categoryId));
  state.entries.push(entry);
  if ((input.source ?? "manual") === "manual") learnClassificationRule(state, entry);
  return entry;
}

export function updateEntry(state: FinanceState, id: string, input: EntryInput): LedgerEntry {
  const index = state.entries.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Lançamento não encontrado.");
  const previous = state.entries[index];
  const updated = buildEntry(input, id, previous.createdAt, categoryFlow(state, input.categoryId));
  state.entries[index] = updated;
  if ((input.source ?? "manual") === "manual") learnClassificationRule(state, updated);
  return updated;
}

export function removeEntry(state: FinanceState, id: string) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) throw new Error("Lançamento não encontrado.");
  state.entries = entry.transferGroupId
    ? state.entries.filter((item) => item.transferGroupId !== entry.transferGroupId)
    : state.entries.filter((item) => item.id !== id);
}

export function institutionBalance(state: FinanceState, institutionId: string): string {
  const institution = state.institutions.find((item) => item.id === institutionId);
  if (!institution) throw new Error("Instituição não encontrada.");
  return state.entries
    .filter((item) => item.institutionId === institutionId)
    .reduce((sum, item) => sum.plus(item.amount), new Decimal(institution.openingBalance))
    .toString();
}

export function reconcileInstitution(
  state: FinanceState,
  institutionId: string,
  targetBalance: string,
  date: string,
  notes?: string,
): LedgerEntry {
  const institution = state.institutions.find((item) => item.id === institutionId);
  if (!institution) throw new Error("Instituição não encontrada.");
  const difference = new Decimal(targetBalance).minus(institutionBalance(state, institutionId));
  return recordEntry(state, {
    date,
    description: "Ajuste manual de saldo",
    amount: difference.toString(),
    currency: institution.currency,
    brlRate: institution.exchangeRate,
    kind: "adjustment",
    institutionId,
    notes,
    source: "reconciliation",
  });
}

export function transfer(
  state: FinanceState,
  input: {
    fromInstitutionId: string;
    toInstitutionId: string;
    amount: string;
    date: string;
    description?: string;
  },
): [LedgerEntry, LedgerEntry] {
  const from = state.institutions.find((item) => item.id === input.fromInstitutionId);
  const to = state.institutions.find((item) => item.id === input.toInstitutionId);
  if (!from || !to || from.id === to.id)
    throw new Error("Selecione instituições diferentes e válidas.");
  if (from.currency !== to.currency)
    throw new Error("Transferências diretas exigem instituições na mesma moeda.");
  const group = uid("transfer");
  const shared = {
    date: input.date,
    description: input.description || `Transferência ${from.name} → ${to.name}`,
    currency: from.currency,
    kind: "transfer" as const,
    transferGroupId: group,
    ignoredFromAnalytics: true,
    source: "manual" as const,
  };
  const debit = buildEntry({
    ...shared,
    institutionId: from.id,
    amount: new Decimal(input.amount).abs().negated().toString(),
    brlRate: from.exchangeRate,
  });
  const credit = buildEntry({
    ...shared,
    institutionId: to.id,
    amount: new Decimal(input.amount).abs().toString(),
    brlRate: to.exchangeRate,
  });
  state.entries.push(debit, credit);
  return [debit, credit];
}
