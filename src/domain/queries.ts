import Decimal from "decimal.js";
import type { FinanceState, FinancialMovement, LedgerEntry, PeriodFilter, Summary } from "./types";
import { entriesForMovement, institutionBalance, movementKindFromEntry, movementsFor } from "./ledger";
import { endOfMonth, format, subMonths } from "date-fns";

export function matchesPeriod(date: string, filter: PeriodFilter): boolean {
  if (filter.mode === "all") return true;
  const value = date.slice(0, 10);
  if (filter.mode === "custom") return (!filter.startDate || value >= filter.startDate) && (!filter.endDate || value <= filter.endDate);
  const parsed = new Date(`${value}T12:00:00`);
  if (filter.mode === "year") return parsed.getFullYear() === filter.year;
  return parsed.getFullYear() === filter.year && parsed.getMonth() + 1 === filter.month;
}

const categoryFor = (state: FinanceState, categoryId?: string) =>
  state.categories.find((category) => category.id === categoryId && !category.archivedAt);

/** Analytics use economic nature, never the sign of an arbitrary transfer leg. */
export const isIncomeMovement = (movement: FinancialMovement) =>
  movement.kind === "income" || movement.kind === "investment_income";
export const isExpenseMovement = (movement: FinancialMovement) =>
  movement.kind === "expense" || movement.kind === "card_purchase" || movement.kind === "card_fee" || movement.kind === "card_interest";

/** Compatibility API for existing classification and card callers. */
export function isAnalyticExpense(state: FinanceState, entry: LedgerEntry) {
  const category = categoryFor(state, entry.categoryId);
  const kind = movementKindFromEntry(entry, category?.flow);
  return isExpenseMovement({ kind } as FinancialMovement);
}

export function isAnalyticIncome(state: FinanceState, entry: LedgerEntry) {
  const category = categoryFor(state, entry.categoryId);
  const kind = movementKindFromEntry(entry, category?.flow);
  return isIncomeMovement({ kind } as FinancialMovement);
}

export function buildSummary(state: FinanceState, filter: PeriodFilter): Summary {
  const movements = movementsFor(state).filter((item) => matchesPeriod(item.date, filter));
  const income = movements.filter(isIncomeMovement).reduce((sum, item) => sum.plus(item.brlAmount), new Decimal(0));
  const expenses = movements.filter(isExpenseMovement).reduce((sum, item) => sum.plus(item.brlAmount), new Decimal(0));
  const available = state.institutions.filter((item) => !item.archivedAt).reduce(
    (sum, item) => sum.plus(new Decimal(institutionBalance(state, item.id)).mul(item.exchangeRate)), new Decimal(0),
  );
  const invested = state.investments.filter((item) => !item.archivedAt).reduce((sum, item) => {
    const institution = state.institutions.find((candidate) => candidate.id === item.institutionId);
    const rate = item.currency === "BRL" ? new Decimal(1) : new Decimal(institution?.exchangeRate ?? 0);
    return sum.plus(new Decimal(item.currentValue).mul(rate));
  }, new Decimal(0));
  const categoryMap = new Map<string, Decimal>();
  for (const movement of movements.filter(isExpenseMovement)) {
    const key = movement.categoryId ?? "uncategorized";
    categoryMap.set(key, (categoryMap.get(key) ?? new Decimal(0)).plus(movement.brlAmount));
  }
  const categoryTotals = [...categoryMap].map(([categoryId, amount]) => {
    const category = categoryFor(state, categoryId);
    return { categoryId: categoryId === "uncategorized" ? undefined : categoryId, name: category?.name ?? "Sem categoria", color: category?.color ?? "#94a3b8", amount: amount.toString() };
  }).sort((a, b) => new Decimal(b.amount).cmp(a.amount));
  return { expenses: expenses.toString(), income: income.toString(), available: available.toString(), invested: invested.toString(), categoryTotals };
}

export interface SummaryComparisonValue {
  current: string;
  previous: string;
  delta: string;
  percentage?: string;
}

export type SummaryComparison = Record<"expenses" | "income" | "available" | "invested", SummaryComparisonValue>;

function valueComparison(current: string, previous: string): SummaryComparisonValue {
  const currentValue = new Decimal(current);
  const previousValue = new Decimal(previous);
  const delta = currentValue.minus(previousValue);
  return {
    current,
    previous,
    delta: delta.toString(),
    percentage: previousValue.isZero() ? undefined : delta.div(previousValue.abs()).mul(100).toDecimalPlaces(1).toString(),
  };
}

function availableAt(state: FinanceState, endDate: string) {
  return state.institutions.filter((item) => !item.archivedAt).reduce((sum, item) => {
    const balance = state.entries
      .filter((entry) => entry.institutionId === item.id && entry.date.slice(0, 10) <= endDate)
      .reduce((value, entry) => value.plus(entry.amount), new Decimal(item.openingBalance));
    return sum.plus(balance.mul(item.exchangeRate));
  }, new Decimal(0)).toString();
}

function previousMonthFilter(filter: PeriodFilter): { previous: PeriodFilter; previousEnd: string } | undefined {
  if (filter.mode !== "month" || !filter.year || !filter.month) return undefined;
  const current = new Date(filter.year, filter.month - 1, 1, 12);
  const previous = subMonths(current, 1);
  return {
    previous: { mode: "month", year: previous.getFullYear(), month: previous.getMonth() + 1 },
    previousEnd: format(endOfMonth(previous), "yyyy-MM-dd"),
  };
}

/** Compares the selected month with the immediately preceding month. */
export function buildSummaryComparison(state: FinanceState, filter: PeriodFilter): SummaryComparison | undefined {
  const bounds = previousMonthFilter(filter);
  if (!bounds) return undefined;
  const current = buildSummary(state, filter);
  const previous = buildSummary(state, bounds.previous);
  return {
    expenses: valueComparison(current.expenses, previous.expenses),
    income: valueComparison(current.income, previous.income),
    available: valueComparison(current.available, availableAt(state, bounds.previousEnd)),
    invested: valueComparison(current.invested, previous.invested),
  };
}

function historyEntry(state: FinanceState, movement: FinancialMovement): LedgerEntry {
  const leg = entriesForMovement(state, movement.id)[0];
  if (leg) return { ...leg, kind: movement.kind === "internal_transfer" ? "internal_transfer" : leg.kind };
  return {
    id: movement.id, date: movement.date, description: movement.description, amount: movement.amount,
    brlAmount: movement.brlAmount, currency: movement.currency, kind: movement.kind === "investment_income" ? "investment_income" : "income",
    categoryId: movement.categoryId, investmentId: movement.investmentId, creditCardId: movement.creditCardId,
    source: movement.source, ignoredFromAnalytics: false, createdAt: movement.createdAt, updatedAt: movement.updatedAt,
  };
}

/** One history item per business event, so a transfer never appears twice. */
export function monthlyHistory(state: FinanceState) {
  const months = new Map<string, { income: Decimal; expenses: Decimal; entries: LedgerEntry[] }>();
  for (const movement of movementsFor(state).filter((item) => !item.systemGenerated)) {
    const key = movement.date.slice(0, 7);
    const current = months.get(key) ?? { income: new Decimal(0), expenses: new Decimal(0), entries: [] };
    if (isIncomeMovement(movement)) current.income = current.income.plus(movement.brlAmount);
    if (isExpenseMovement(movement)) current.expenses = current.expenses.plus(movement.brlAmount);
    current.entries.push(historyEntry(state, movement));
    months.set(key, current);
  }
  return [...months].sort(([a], [b]) => b.localeCompare(a)).map(([month, value]) => ({
    month, income: value.income.toString(), expenses: value.expenses.toString(), balance: value.income.minus(value.expenses).toString(),
    entries: [...value.entries].sort((a, b) => b.date.localeCompare(a.date)),
  }));
}
