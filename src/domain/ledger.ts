import Decimal from "decimal.js";
import { now, uid } from "./defaults";
import { learnClassificationRule } from "./classification";
import type {
  CategoryFlow,
  FinanceState,
  FinancialMovement,
  FinancialMovementKind,
  Investment,
  LedgerEntry,
} from "./types";

export type EntryInput = Omit<
  LedgerEntry,
  "id" | "amount" | "brlAmount" | "createdAt" | "updatedAt" | "source" | "ignoredFromAnalytics"
> & { amount: string; brlRate?: string; source?: LedgerEntry["source"]; ignoredFromAnalytics?: boolean };

type MovementInput = Pick<FinancialMovement, "kind" | "date" | "description" | "amount" | "currency"> &
  Partial<Pick<FinancialMovement, "categoryId" | "paymentMethod" | "investmentId" | "creditCardId" | "importedDocumentId" | "plannedOccurrenceKey" | "relatedMovementId" | "notes" | "fingerprint" | "legacyUnbalanced" | "systemGenerated">> &
  { brlRate?: string; source?: LedgerEntry["source"] };

const negativeKinds = new Set(["expense", "investment", "reserve", "credit_payment", "card_purchase", "card_fee", "card_interest"]);
const neutralLegKinds = new Set<LedgerEntry["kind"]>(["transfer", "pix", "adjustment", "internal_transfer", "investment_contribution", "investment_withdrawal"]);

/** A category is more precise than a generic imported Pix label. */
export const signedAmount = (kind: LedgerEntry["kind"], value: string, flow?: CategoryFlow) => {
  const decimal = new Decimal(value || 0);
  if (flow) return (flow === "expense" ? decimal.abs().negated() : decimal.abs()).toString();
  if (neutralLegKinds.has(kind)) return decimal.toString();
  return (negativeKinds.has(kind) ? decimal.abs().negated() : decimal.abs()).toString();
};

const categoryFlow = (state: FinanceState, categoryId?: string): CategoryFlow | undefined =>
  categoryId ? state.categories.find((item) => item.id === categoryId)?.flow : undefined;

function buildEntry(input: EntryInput, id = uid("entry"), createdAt = now(), flow?: CategoryFlow): LedgerEntry {
  const amount = signedAmount(input.kind, input.amount, flow);
  const rate = new Decimal(input.brlRate ?? (input.currency === "BRL" ? 1 : 0));
  return {
    ...input, id, amount, brlAmount: new Decimal(amount).mul(rate).toString(), source: input.source ?? "manual",
    paymentMethod: input.paymentMethod ?? (input.kind === "card_purchase" ? "credit_card" : undefined),
    // Kept for legacy callers only. Analytics now use FinancialMovement.kind.
    ignoredFromAnalytics: input.ignoredFromAnalytics ?? (input.kind === "transfer" || input.kind === "internal_transfer" || input.kind === "investment_contribution" || input.kind === "investment_withdrawal" || input.kind === "credit_payment"),
    createdAt, updatedAt: now(),
  };
}

function assertAccount(state: FinanceState, institutionId: string) {
  const account = state.institutions.find((item) => item.id === institutionId && !item.archivedAt);
  if (!account) throw new Error("Conta inválida ou arquivada.");
  return account;
}

function assertInvestment(state: FinanceState, investmentId: string) {
  const investment = state.investments.find((item) => item.id === investmentId && !item.archivedAt);
  if (!investment) throw new Error("Investimento inválido ou arquivado.");
  return investment;
}

function entryKindForMovement(kind: FinancialMovementKind): LedgerEntry["kind"] {
  if (kind === "internal_transfer") return "internal_transfer";
  if (kind === "investment_contribution") return "investment_contribution";
  if (kind === "investment_withdrawal") return "investment_withdrawal";
  if (kind === "investment_income") return "investment_income";
  return kind;
}

export function createFinancialMovement(state: FinanceState, input: MovementInput): FinancialMovement {
  const amount = new Decimal(input.amount).abs();
  if (amount.isZero()) throw new Error("O valor da movimentação deve ser maior que zero.");
  const rate = new Decimal(input.brlRate ?? (input.currency === "BRL" ? 1 : 0));
  const movement: FinancialMovement = {
    id: uid("movement"), kind: input.kind, date: input.date, description: input.description,
    amount: amount.toString(), currency: input.currency, brlAmount: amount.mul(rate).toString(),
    categoryId: input.categoryId, paymentMethod: input.paymentMethod, investmentId: input.investmentId, creditCardId: input.creditCardId,
    importedDocumentId: input.importedDocumentId, plannedOccurrenceKey: input.plannedOccurrenceKey,
    relatedMovementId: input.relatedMovementId, source: input.source ?? "manual", notes: input.notes,
    fingerprint: input.fingerprint, legacyUnbalanced: input.legacyUnbalanced, systemGenerated: input.systemGenerated, createdAt: now(), updatedAt: now(),
  };
  state.financialMovements.push(movement);
  return movement;
}

function addLeg(state: FinanceState, movement: FinancialMovement, input: Omit<EntryInput, "financialMovementId" | "transferGroupId" | "kind"> & { amount: string }): LedgerEntry {
  const entry = buildEntry({
    ...input, kind: entryKindForMovement(movement.kind), financialMovementId: movement.id,
    transferGroupId: movement.kind === "internal_transfer" ? movement.id : undefined,
    source: movement.source, categoryId: input.categoryId ?? movement.categoryId,
    importedDocumentId: input.importedDocumentId ?? movement.importedDocumentId,
    plannedOccurrenceKey: input.plannedOccurrenceKey ?? movement.plannedOccurrenceKey,
  });
  state.entries.push(entry);
  return entry;
}

/** Creates a one-leg income/expense/card event while preserving the old return contract. */
export function recordEntry(state: FinanceState, input: EntryInput): LedgerEntry {
  if (input.paymentMethod === "credit_card" && input.kind !== "card_purchase") {
    throw new Error("Compra no cartão deve ser registrada com o cartão selecionado.");
  }
  if (input.kind === "card_purchase" && (!input.creditCardId || input.institutionId)) {
    throw new Error("Compra no cartão exige um cartão e não pode debitar uma conta.");
  }
  if (input.institutionId) assertAccount(state, input.institutionId);
  if (input.investmentId) assertInvestment(state, input.investmentId);
  if (input.categoryId && !state.categories.some((item) => item.id === input.categoryId && !item.archivedAt)) throw new Error("Categoria inválida ou arquivada.");
  const flow = categoryFlow(state, input.categoryId);
  const entry = buildEntry(input, undefined, undefined, flow);
  const movement = createFinancialMovement(state, {
    kind: movementKindFromEntry(entry, flow), date: entry.date, description: entry.description, amount: entry.amount,
    currency: entry.currency, brlRate: input.brlRate, categoryId: entry.categoryId, investmentId: entry.investmentId,
    creditCardId: entry.creditCardId, importedDocumentId: entry.importedDocumentId, paymentMethod: entry.paymentMethod,
    plannedOccurrenceKey: entry.plannedOccurrenceKey, notes: entry.notes, fingerprint: entry.fingerprint, systemGenerated: entry.systemGenerated, source: entry.source,
  });
  entry.financialMovementId = movement.id;
  state.entries.push(entry);
  if ((input.source ?? "manual") === "manual") learnClassificationRule(state, entry);
  return entry;
}

export function updateEntry(state: FinanceState, id: string, input: EntryInput): LedgerEntry {
  const index = state.entries.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Lançamento não encontrado.");
  const previous = state.entries[index];
  const movement = previous.financialMovementId ? state.financialMovements.find((item) => item.id === previous.financialMovementId) : undefined;
  if (movement && state.entries.filter((item) => item.financialMovementId === movement.id).length > 1) throw new Error("Edite uma transferência, aplicação ou resgate pelo movimento completo.");
  const updated = buildEntry({ ...input, financialMovementId: previous.financialMovementId }, id, previous.createdAt, categoryFlow(state, input.categoryId));
  state.entries[index] = updated;
  if (movement) {
    Object.assign(movement, {
      kind: movementKindFromEntry(updated, categoryFlow(state, updated.categoryId)), date: updated.date,
      description: updated.description, amount: new Decimal(updated.amount).abs().toString(), currency: updated.currency,
      brlAmount: new Decimal(updated.brlAmount).abs().toString(), categoryId: updated.categoryId,
      investmentId: updated.investmentId, creditCardId: updated.creditCardId, importedDocumentId: updated.importedDocumentId, paymentMethod: updated.paymentMethod,
      notes: updated.notes, fingerprint: updated.fingerprint, source: updated.source, updatedAt: now(),
      systemGenerated: updated.systemGenerated,
    });
  }
  if ((input.source ?? "manual") === "manual") learnClassificationRule(state, updated);
  return updated;
}

export function removeMovement(state: FinanceState, movementId: string) {
  if (!state.financialMovements.some((item) => item.id === movementId)) throw new Error("Movimentação não encontrada.");
  const entryIds = new Set(state.entries.filter((item) => item.financialMovementId === movementId).map((item) => item.id));
  state.cardPurchases = state.cardPurchases.filter((item) => !entryIds.has(item.ledgerEntryId));
  state.entries = state.entries.filter((item) => item.financialMovementId !== movementId);
  state.financialMovements = state.financialMovements.filter((item) => item.id !== movementId && item.relatedMovementId !== movementId);
}

export function removeEntry(state: FinanceState, id: string) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) throw new Error("Lançamento não encontrado.");
  if (entry.financialMovementId) return removeMovement(state, entry.financialMovementId);
  const entryIds = new Set(
    entry.transferGroupId
      ? state.entries.filter((item) => item.transferGroupId === entry.transferGroupId).map((item) => item.id)
      : [id],
  );
  state.cardPurchases = state.cardPurchases.filter((item) => !entryIds.has(item.ledgerEntryId));
  state.entries = entry.transferGroupId ? state.entries.filter((item) => item.transferGroupId !== entry.transferGroupId) : state.entries.filter((item) => item.id !== id);
}

export function institutionBalance(state: FinanceState, institutionId: string): string {
  const institution = state.institutions.find((item) => item.id === institutionId);
  if (!institution) throw new Error("Instituição não encontrada.");
  return state.entries.filter((item) => item.institutionId === institutionId).reduce((sum, item) => sum.plus(item.amount), new Decimal(institution.openingBalance)).toString();
}

export function reconcileInstitution(state: FinanceState, institutionId: string, targetBalance: string, date: string, notes?: string): LedgerEntry {
  const institution = assertAccount(state, institutionId);
  const difference = new Decimal(targetBalance).minus(institutionBalance(state, institutionId));
  return recordEntry(state, { date, description: "Ajuste manual de saldo", amount: difference.toString(), currency: institution.currency, brlRate: institution.exchangeRate, kind: "adjustment", institutionId, notes, source: "reconciliation" });
}

export function transfer(state: FinanceState, input: { fromInstitutionId: string; toInstitutionId: string; amount: string; date: string; description?: string }): [LedgerEntry, LedgerEntry] {
  const from = assertAccount(state, input.fromInstitutionId);
  const to = assertAccount(state, input.toInstitutionId);
  if (from.id === to.id) throw new Error("Selecione contas diferentes.");
  if (from.currency !== to.currency) throw new Error("Transferências diretas exigem contas na mesma moeda.");
  const movement = createFinancialMovement(state, { kind: "internal_transfer", date: input.date, description: input.description || `Transferência ${from.name} → ${to.name}`, amount: input.amount, currency: from.currency, brlRate: from.exchangeRate });
  const debit = addLeg(state, movement, { date: input.date, description: movement.description, amount: new Decimal(input.amount).abs().negated().toString(), currency: from.currency, brlRate: from.exchangeRate, institutionId: from.id });
  const credit = addLeg(state, movement, { date: input.date, description: movement.description, amount: new Decimal(input.amount).abs().toString(), currency: to.currency, brlRate: to.exchangeRate, institutionId: to.id });
  return [debit, credit];
}

function updateInvestmentContribution(investment: Investment, amount: Decimal) {
  investment.investedAmount = new Decimal(investment.investedAmount).plus(amount).toString();
  investment.currentValue = new Decimal(investment.currentValue).plus(amount).toString();
  if (new Decimal(investment.quantity).isZero()) investment.quantity = "1";
  investment.averagePrice = new Decimal(investment.investedAmount).div(investment.quantity).toString();
  investment.currentPrice = new Decimal(investment.currentValue).div(investment.quantity).toString();
  investment.updatedAt = now();
}

export function investmentContribution(state: FinanceState, input: { fromInstitutionId: string; investmentId: string; amount: string; date: string; description?: string }) {
  const from = assertAccount(state, input.fromInstitutionId);
  const investment = assertInvestment(state, input.investmentId);
  if (from.currency !== investment.currency) throw new Error("Aporte exige conta e investimento na mesma moeda.");
  const movement = createFinancialMovement(state, { kind: "investment_contribution", date: input.date, description: input.description || `Aplicação em ${investment.name}`, amount: input.amount, currency: from.currency, brlRate: from.exchangeRate, investmentId: investment.id });
  const debit = addLeg(state, movement, { date: input.date, description: movement.description, amount: new Decimal(input.amount).abs().negated().toString(), currency: from.currency, brlRate: from.exchangeRate, institutionId: from.id });
  const credit = addLeg(state, movement, { date: input.date, description: movement.description, amount: new Decimal(input.amount).abs().toString(), currency: investment.currency, brlRate: from.exchangeRate, investmentId: investment.id });
  updateInvestmentContribution(investment, new Decimal(input.amount).abs());
  return { movement, debit, credit };
}

export function investmentWithdrawal(state: FinanceState, input: { toInstitutionId: string; investmentId: string; amount: string; date: string; description?: string }) {
  const to = assertAccount(state, input.toInstitutionId);
  const investment = assertInvestment(state, input.investmentId);
  const amount = new Decimal(input.amount).abs();
  const currentValue = new Decimal(investment.currentValue);
  if (to.currency !== investment.currency) throw new Error("Resgate exige conta e investimento na mesma moeda.");
  if (amount.gt(currentValue)) throw new Error("O resgate não pode superar o valor atual do investimento.");
  const cost = Decimal.min(new Decimal(investment.investedAmount), new Decimal(investment.investedAmount).mul(amount).div(currentValue));
  const income = Decimal.max(new Decimal(0), amount.minus(cost));
  const movement = createFinancialMovement(state, { kind: "investment_withdrawal", date: input.date, description: input.description || `Resgate de ${investment.name}`, amount: amount.toString(), currency: to.currency, brlRate: to.exchangeRate, investmentId: investment.id });
  const debit = addLeg(state, movement, { date: input.date, description: movement.description, amount: amount.negated().toString(), currency: investment.currency, brlRate: to.exchangeRate, investmentId: investment.id });
  const credit = addLeg(state, movement, { date: input.date, description: movement.description, amount: amount.toString(), currency: to.currency, brlRate: to.exchangeRate, institutionId: to.id });
  investment.currentValue = currentValue.minus(amount).toString();
  investment.investedAmount = new Decimal(investment.investedAmount).minus(cost).toString();
  if (!currentValue.isZero()) investment.quantity = new Decimal(investment.quantity).mul(new Decimal(investment.currentValue)).div(currentValue).toString();
  investment.averagePrice = new Decimal(investment.quantity).isZero() ? "0" : new Decimal(investment.investedAmount).div(investment.quantity).toString();
  investment.currentPrice = new Decimal(investment.quantity).isZero() ? "0" : new Decimal(investment.currentValue).div(investment.quantity).toString();
  investment.updatedAt = now();
  const incomeMovement = income.isZero() ? undefined : createFinancialMovement(state, { kind: "investment_income", date: input.date, description: `Rendimento realizado • ${investment.name}`, amount: income.toString(), currency: to.currency, brlRate: to.exchangeRate, investmentId: investment.id, relatedMovementId: movement.id, source: "reconciliation" });
  return { movement, debit, credit, principal: cost.toString(), income: income.toString(), incomeMovement };
}

export function investmentIncome(state: FinanceState, input: { investmentId: string; amount: string; date: string; toInstitutionId?: string; reinvest?: boolean; description?: string }) {
  const investment = assertInvestment(state, input.investmentId);
  if (!input.reinvest && !input.toInstitutionId) throw new Error("Escolha a conta de destino ou o reinvestimento do rendimento.");
  const account = input.toInstitutionId ? assertAccount(state, input.toInstitutionId) : undefined;
  if (account && account.currency !== investment.currency) throw new Error("Rendimento exige destino na mesma moeda.");
  const amount = new Decimal(input.amount).abs();
  const rate = account?.exchangeRate ?? (investment.currency === "BRL" ? "1" : "0");
  const movement = createFinancialMovement(state, { kind: "investment_income", date: input.date, description: input.description || `Rendimento de ${investment.name}`, amount: amount.toString(), currency: investment.currency, brlRate: rate, investmentId: investment.id });
  const leg = addLeg(state, movement, { date: input.date, description: movement.description, amount: amount.toString(), currency: investment.currency, brlRate: rate, institutionId: input.reinvest ? undefined : account?.id, investmentId: input.reinvest ? investment.id : undefined });
  investment.dividends = new Decimal(investment.dividends).plus(amount).toString();
  if (input.reinvest) updateInvestmentContribution(investment, amount);
  investment.updatedAt = now();
  return { movement, leg };
}

export function movementKindFromEntry(entry: LedgerEntry, flow?: CategoryFlow): FinancialMovementKind {
  switch (entry.kind) {
    case "transfer": case "internal_transfer": return "internal_transfer";
    case "investment": case "reserve": case "investment_contribution": return "investment_contribution";
    case "investment_withdrawal": return "investment_withdrawal";
    case "investment_income": return "investment_income";
    case "card_purchase": case "card_refund": case "card_fee": case "card_interest": case "credit_payment": case "adjustment": return entry.kind;
    case "expense": return "expense";
    case "income": return "income";
    case "pix": return flow === "expense" || new Decimal(entry.amount).isNegative() ? "expense" : "income";
  }
}

/** Existing rows become virtual groups until the migration has persisted a header. */
export function movementsFor(state: FinanceState): FinancialMovement[] {
  const stored = new Map(state.financialMovements.map((item) => [item.id, item]));
  const legacyGroups = new Map<string, LedgerEntry[]>();
  for (const entry of state.entries) {
    if (entry.financialMovementId && stored.has(entry.financialMovementId)) continue;
    const key = entry.transferGroupId || entry.id;
    legacyGroups.set(key, [...(legacyGroups.get(key) ?? []), entry]);
  }
  const legacy = [...legacyGroups.entries()].map(([id, entries]) => {
    const first = entries[0];
    const amount = entries.reduce((max, item) => Decimal.max(max, new Decimal(item.amount).abs()), new Decimal(0));
    const brlAmount = entries.reduce((max, item) => Decimal.max(max, new Decimal(item.brlAmount).abs()), new Decimal(0));
    return { id, kind: movementKindFromEntry(first, categoryFlow(state, first.categoryId)), date: first.date, description: first.description, amount: amount.toString(), currency: first.currency, brlAmount: brlAmount.toString(), categoryId: first.categoryId, investmentId: first.investmentId, creditCardId: first.creditCardId, importedDocumentId: first.importedDocumentId, plannedOccurrenceKey: first.plannedOccurrenceKey, source: first.source, notes: first.notes, fingerprint: first.fingerprint, legacyUnbalanced: entries.length === 1 && ["investment", "reserve"].includes(first.kind), createdAt: first.createdAt, updatedAt: first.updatedAt } satisfies FinancialMovement;
  });
  return [...state.financialMovements, ...legacy];
}

export function entriesForMovement(state: FinanceState, movementId: string) {
  return state.entries.filter((entry) => entry.financialMovementId === movementId || (!entry.financialMovementId && (entry.transferGroupId || entry.id) === movementId));
}
