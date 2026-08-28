import { addDays, addMonths, addWeeks, addYears, formatISO, parseISO, subDays } from "date-fns";
import type { FinanceState, PlannedEntry, RecurrenceException } from "./types";
import { recordEntry } from "./ledger";
import { now, uid } from "./defaults";

const day = (date: Date) => formatISO(date, { representation: "date" });
function advance(
  date: Date,
  frequency: PlannedEntry["frequency"],
  anchorDay: number,
): Date {
  if (frequency === "daily") return addDays(date, 1);
  if (frequency === "weekly") return addWeeks(date, 1);
  if (frequency === "biweekly") return addWeeks(date, 2);
  if (frequency === "yearly") return addYears(date, 1);
  if (frequency === "monthly") {
    const first = new Date(date.getFullYear(), date.getMonth() + 1, 1, 12);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
    first.setDate(Math.min(anchorDay, last));
    return first;
  }
  return addMonths(date, 10000);
}

export interface PlannedOccurrence {
  key: string;
  planId: string;
  date: string;
  description: string;
  amount: string;
  kind: "income" | "expense";
  categoryId?: string;
  institutionId?: string;
  settled: boolean;
}

export function occurrencesFor(
  plan: PlannedEntry,
  startDate: string,
  endDate: string,
): PlannedOccurrence[] {
  const exceptions = new Map(plan.exceptions.map((item) => [item.date, item]));
  const result: PlannedOccurrence[] = [];
  let cursor = parseISO(plan.startDate);
  const anchorDay = cursor.getDate();
  const anchorMonth = cursor.getMonth();
  let count = 0;
  while (day(cursor) <= endDate && count < (plan.occurrenceCount ?? 10000)) {
    const date = day(cursor);
    const exception = exceptions.get(date);
    if (date >= startDate && (!plan.endDate || date <= plan.endDate) && !exception?.deleted) {
      result.push({
        key: `${plan.id}:${date}`,
        planId: plan.id,
        date,
        description: exception?.description ?? plan.description,
        amount: exception?.amount ?? plan.amount,
        kind: exception?.kind ?? plan.kind,
        categoryId: exception?.categoryId ?? plan.categoryId,
        institutionId: exception?.institutionId ?? plan.institutionId,
        settled: Boolean(exception?.settledEntryId),
      });
    }
    count += 1;
    if (plan.frequency === "once") break;
    if (plan.frequency === "yearly") {
      const nextYear = cursor.getFullYear() + 1;
      const last = new Date(nextYear, anchorMonth + 1, 0, 12).getDate();
      cursor = new Date(nextYear, anchorMonth, Math.min(anchorDay, last), 12);
    } else {
      cursor = advance(cursor, plan.frequency, anchorDay);
    }
    if (plan.endDate && day(cursor) > plan.endDate) break;
  }
  return result;
}

export function settleOccurrence(state: FinanceState, planId: string, occurrenceDate: string) {
  const plan = state.plannedEntries.find((item) => item.id === planId);
  if (!plan) throw new Error("Planejamento não encontrado.");
  const occurrence = occurrencesFor(plan, occurrenceDate, occurrenceDate)[0];
  if (!occurrence) throw new Error("Ocorrência inválida.");
  const existing = state.entries.find((item) => item.plannedOccurrenceKey === occurrence.key);
  if (existing) return existing;
  const institution = state.institutions.find((item) => item.id === occurrence.institutionId);
  const entry = recordEntry(state, {
    date: occurrence.date,
    description: occurrence.description,
    amount: occurrence.amount,
    currency: institution?.currency ?? "BRL",
    brlRate: institution?.exchangeRate ?? "1",
    kind: occurrence.kind,
    categoryId: occurrence.categoryId,
    institutionId: occurrence.institutionId,
    plannedOccurrenceKey: occurrence.key,
    source: "planned",
  });
  const exception: RecurrenceException = plan.exceptions.find(
    (item) => item.date === occurrenceDate,
  ) ?? { date: occurrenceDate };
  exception.settledEntryId = entry.id;
  plan.exceptions = [...plan.exceptions.filter((item) => item.date !== occurrenceDate), exception];
  plan.updatedAt = now();
  return entry;
}

export function editRecurrence(
  state: FinanceState,
  planId: string,
  effectiveDate: string,
  changes: Partial<
    Pick<PlannedEntry, "description" | "amount" | "kind" | "categoryId" | "institutionId">
  >,
  mode: "one" | "future" | "all",
) {
  const plan = state.plannedEntries.find((item) => item.id === planId);
  if (!plan) throw new Error("Planejamento não encontrado.");
  if (mode === "all") {
    Object.assign(plan, changes, { updatedAt: now() });
    return plan;
  }
  if (mode === "one") {
    const previous = plan.exceptions.find((item) => item.date === effectiveDate) ?? {
      date: effectiveDate,
    };
    const exception = {
      ...previous,
      description: changes.description ?? previous.description,
      amount: changes.amount ?? previous.amount,
      kind: changes.kind ?? previous.kind,
      categoryId: changes.categoryId ?? previous.categoryId,
      institutionId: changes.institutionId ?? previous.institutionId,
    };
    plan.exceptions = [...plan.exceptions.filter((item) => item.date !== effectiveDate), exception];
    return plan;
  }
  const originalEndDate = plan.endDate;
  const originalOccurrenceCount = plan.occurrenceCount;
  const priorOccurrences = occurrencesFor(
    plan,
    plan.startDate,
    day(subDays(parseISO(effectiveDate), 1)),
  ).length;
  const futureExceptions = plan.exceptions.filter((item) => item.date >= effectiveDate);
  plan.endDate = day(subDays(parseISO(effectiveDate), 1));
  plan.exceptions = plan.exceptions.filter((item) => item.date < effectiveDate);
  const split: PlannedEntry = {
    ...plan,
    ...changes,
    id: uid("plan"),
    startDate: effectiveDate,
    endDate: originalEndDate,
    occurrenceCount: originalOccurrenceCount
      ? Math.max(1, originalOccurrenceCount - priorOccurrences)
      : undefined,
    exceptions: futureExceptions,
    createdAt: now(),
    updatedAt: now(),
  };
  state.plannedEntries.push(split);
  return split;
}
