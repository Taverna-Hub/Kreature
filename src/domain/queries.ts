import Decimal from "decimal.js";
import type { FinanceState, LedgerEntry, PeriodFilter, Summary } from "./types";
import { institutionBalance } from "./ledger";

export function matchesPeriod(date: string, filter: PeriodFilter): boolean {
  if (filter.mode === "all") return true;
  const value = date.slice(0, 10);
  if (filter.mode === "custom")
    return (
      (!filter.startDate || value >= filter.startDate) &&
      (!filter.endDate || value <= filter.endDate)
    );
  const parsed = new Date(`${value}T12:00:00`);
  if (filter.mode === "year") return parsed.getFullYear() === filter.year;
  return parsed.getFullYear() === filter.year && parsed.getMonth() + 1 === filter.month;
}

const included = (entry: LedgerEntry, includeInternal: boolean) =>
  includeInternal || !entry.ignoredFromAnalytics;

export function buildSummary(
  state: FinanceState,
  filter: PeriodFilter,
  includeInternal = false,
): Summary {
  const entries = state.entries.filter(
    (item) => matchesPeriod(item.date, filter) && included(item, includeInternal),
  );
  const income = entries
    .filter((item) => item.kind === "income")
    .reduce((sum, item) => sum.plus(item.brlAmount), new Decimal(0));
  const expenses = entries
    .filter((item) => item.kind === "expense" || item.kind === "card_purchase")
    .reduce((sum, item) => sum.plus(new Decimal(item.brlAmount).abs()), new Decimal(0));
  const available = state.institutions
    .filter((item) => !item.archivedAt)
    .reduce(
      (sum, item) =>
        sum.plus(new Decimal(institutionBalance(state, item.id)).mul(item.exchangeRate)),
      new Decimal(0),
    );
  const invested = state.investments
    .filter((item) => !item.archivedAt)
    .reduce((sum, item) => {
      const institution = state.institutions.find(
        (candidate) => candidate.id === item.institutionId,
      );
      const rate =
        item.currency === "BRL" ? new Decimal(1) : new Decimal(institution?.exchangeRate ?? 0);
      return sum.plus(new Decimal(item.currentValue).mul(rate));
    }, new Decimal(0));
  const categoryMap = new Map<string, Decimal>();
  entries
    .filter((item) => item.kind === "expense" || item.kind === "card_purchase")
    .forEach((item) => {
      const key = item.categoryId ?? "uncategorized";
      categoryMap.set(
        key,
        (categoryMap.get(key) ?? new Decimal(0)).plus(new Decimal(item.brlAmount).abs()),
      );
    });
  const categoryTotals = [...categoryMap]
    .map(([categoryId, amount]) => {
      const category = state.categories.find((item) => item.id === categoryId);
      return {
        categoryId: categoryId === "uncategorized" ? undefined : categoryId,
        name: category?.name ?? "Sem categoria",
        color: category?.color ?? "#94a3b8",
        amount: amount.toString(),
      };
    })
    .sort((a, b) => new Decimal(b.amount).cmp(a.amount));
  return {
    expenses: expenses.toString(),
    income: income.toString(),
    available: available.toString(),
    invested: invested.toString(),
    categoryTotals,
  };
}

export function monthlyHistory(state: FinanceState) {
  const months = new Map<string, { income: Decimal; expenses: Decimal; entries: LedgerEntry[] }>();
  state.entries
    .filter((item) => !item.ignoredFromAnalytics)
    .forEach((entry) => {
      const key = entry.date.slice(0, 7);
      const current = months.get(key) ?? {
        income: new Decimal(0),
        expenses: new Decimal(0),
        entries: [],
      };
      const amount = new Decimal(entry.brlAmount);
      if (amount.isPositive()) current.income = current.income.plus(amount);
      if (amount.isNegative()) current.expenses = current.expenses.plus(amount.abs());
      current.entries.push(entry);
      months.set(key, current);
    });
  return [...months]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, value]) => ({
      month,
      income: value.income.toString(),
      expenses: value.expenses.toString(),
      balance: value.income.minus(value.expenses).toString(),
      entries: value.entries.sort((a, b) => b.date.localeCompare(a.date)),
    }));
}
