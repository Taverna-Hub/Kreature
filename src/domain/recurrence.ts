import { addDays, addMonths, addWeeks, addYears, formatISO, parseISO, subDays } from "date-fns";
import type { FinanceState, PlannedEntry, RecurrenceException } from "./types";
import { recordEntry, removeEntry } from "./ledger";
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
  effectiveDate?: string;
  effectiveAmount?: string;
  settledMovementId?: string;
  canUndo?: boolean;
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
        effectiveDate: exception?.effectiveDate,
        effectiveAmount: exception?.effectiveAmount,
        settledMovementId: exception?.settledMovementId,
        canUndo: Boolean(exception?.settledEntryId && exception.generatedFingerprint),
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

export function settleOccurrence(
  state: FinanceState,
  planId: string,
  occurrenceDate: string,
  realization: { effectiveDate?: string; effectiveAmount?: string } = {},
) {
  const plan = state.plannedEntries.find((item) => item.id === planId);
  if (!plan) throw new Error("Planejamento não encontrado.");
  const occurrence = occurrencesFor(plan, occurrenceDate, occurrenceDate)[0];
  if (!occurrence) throw new Error("Ocorrência inválida.");
  const existing = state.entries.find((item) => item.plannedOccurrenceKey === occurrence.key);
  if (existing) return existing;
  const effectiveDate = realization.effectiveDate ?? day(new Date());
  if (effectiveDate > day(new Date())) throw new Error("A data efetiva nÃ£o pode estar no futuro.");
  const effectiveAmount = realization.effectiveAmount ?? occurrence.amount;
  if (Number(effectiveAmount) <= 0) throw new Error("O valor efetivo deve ser maior que zero.");
  const institution = state.institutions.find((item) => item.id === occurrence.institutionId);
  const entry = recordEntry(state, {
    date: effectiveDate,
    description: occurrence.description,
    amount: effectiveAmount,
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
  exception.settledMovementId = entry.financialMovementId;
  exception.plannedDate = occurrence.date;
  exception.plannedDescription = occurrence.description;
  exception.plannedAmount = occurrence.amount;
  exception.plannedKind = occurrence.kind;
  exception.plannedCategoryId = occurrence.categoryId;
  exception.plannedInstitutionId = occurrence.institutionId;
  exception.effectiveDate = effectiveDate;
  exception.effectiveAmount = effectiveAmount;
  exception.generatedFingerprint = plannedEntryFingerprint(entry);
  plan.exceptions = [...plan.exceptions.filter((item) => item.date !== occurrenceDate), exception];
  plan.updatedAt = now();
  return entry;
}

function plannedEntryFingerprint(entry: { id: string; date: string; description: string; amount: string; kind: string; categoryId?: string; institutionId?: string; source: string; importedDocumentId?: string }) {
  return [entry.id, entry.date, entry.description, entry.amount, entry.kind, entry.categoryId ?? "", entry.institutionId ?? "", entry.source, entry.importedDocumentId ?? ""].join("|");
}

/**
 * Undo is deliberately strict. A planned realization can disappear only when it
 * is still the exact automatic movement; imported, reconciled or edited data
 * remains intact and the user gets a deterministic explanation.
 */
export function undoOccurrence(state: FinanceState, planId: string, occurrenceDate: string) {
  const plan = state.plannedEntries.find((item) => item.id === planId);
  if (!plan) throw new Error("Planejamento nÃ£o encontrado.");
  const exception = plan.exceptions.find((item) => item.date === occurrenceDate);
  if (!exception?.settledEntryId) throw new Error("Esta ocorrÃªncia ainda nÃ£o foi concluÃ­da.");
  const entry = state.entries.find((item) => item.id === exception.settledEntryId);
  const movement = entry?.financialMovementId
    ? state.financialMovements.find((item) => item.id === entry.financialMovementId)
    : undefined;
  if (!entry || !movement) throw new Error("A movimentaÃ§Ã£o realizada nÃ£o estÃ¡ mais disponÃ­vel para desfazer.");
  const isUntouched =
    entry.source === "planned" &&
    movement.source === "planned" &&
    !entry.importedDocumentId &&
    !movement.importedDocumentId &&
    exception.generatedFingerprint === plannedEntryFingerprint(entry) &&
    state.entries.filter((item) => item.financialMovementId === movement.id).length === 1;
  if (!isUntouched)
    throw new Error("NÃ£o Ã© possÃ­vel desfazer: a movimentaÃ§Ã£o realizada foi editada, conciliada ou vinculada a outro registro.");
  removeEntry(state, entry.id);
  Object.assign(exception, {
    settledEntryId: undefined,
    settledMovementId: undefined,
    effectiveDate: undefined,
    effectiveAmount: undefined,
    generatedFingerprint: undefined,
  });
  plan.updatedAt = now();
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
