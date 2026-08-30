import { addDays, addMonths, addWeeks, addYears, formatISO, parseISO, subDays } from "date-fns";
import type { FinanceState, PaymentMethod, PlannedEntry, RecurrenceException } from "./types";
import { recordEntry, removeEntry } from "./ledger";
import { recordCardPurchase } from "./cards";
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
  paymentMethod: PaymentMethod;
  creditCardId?: string;
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
      const settled = Boolean(exception?.settledEntryId);
      result.push({
        key: `${plan.id}:${date}`,
        planId: plan.id,
        date,
        description: settled ? exception?.plannedDescription ?? plan.description : exception?.description ?? plan.description,
        amount: settled ? exception?.plannedAmount ?? plan.amount : exception?.amount ?? plan.amount,
        kind: settled ? exception?.plannedKind ?? plan.kind : exception?.kind ?? plan.kind,
        categoryId: settled ? exception?.plannedCategoryId ?? plan.categoryId : exception?.categoryId ?? plan.categoryId,
        institutionId: settled ? exception?.plannedInstitutionId ?? plan.institutionId : exception?.institutionId ?? plan.institutionId,
        paymentMethod: settled ? exception?.plannedPaymentMethod ?? plan.paymentMethod ?? "pix" : exception?.paymentMethod ?? plan.paymentMethod ?? "pix",
        creditCardId: settled ? exception?.plannedCreditCardId ?? plan.creditCardId : exception?.creditCardId ?? plan.creditCardId,
        settled,
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
  const paymentMethod = occurrence.paymentMethod;
  const effectiveDate = paymentMethod === "credit_card"
    ? occurrence.date
    : realization.effectiveDate ?? occurrence.date;
  if (effectiveDate > day(new Date())) throw new Error("A data efetiva nÃ£o pode estar no futuro.");
  const effectiveAmount = paymentMethod === "credit_card"
    ? occurrence.amount
    : realization.effectiveAmount ?? occurrence.amount;
  if (Number(effectiveAmount) <= 0) throw new Error("O valor efetivo deve ser maior que zero.");
  const institution = occurrence.institutionId
    ? state.institutions.find((item) => item.id === occurrence.institutionId)
    : undefined;
  if (paymentMethod !== "credit_card" && (!occurrence.institutionId || !institution || institution.archivedAt)) throw new Error("Selecione uma conta ativa para concluir a cobrança.");
  if (paymentMethod === "credit_card") {
    if (occurrence.kind !== "expense") throw new Error("Cartão de crédito só pode concluir despesas.");
    if (!occurrence.creditCardId) throw new Error("Selecione um cartão de crédito ativo.");
    const card = state.creditCards.find((item) => item.id === occurrence.creditCardId && !item.archivedAt);
    if (!card || card.cardType === "debit") throw new Error("Selecione um cartão de crédito ativo.");
    const purchase = recordCardPurchase(state, {
      cardId: occurrence.creditCardId,
      description: occurrence.description,
      amount: effectiveAmount,
      currency: state.creditCards.find((item) => item.id === occurrence.creditCardId)?.currency ?? "BRL",
      date: effectiveDate,
      categoryId: occurrence.categoryId,
      installments: 1,
      source: "planned",
      plannedOccurrenceKey: occurrence.key,
    });
    const entry = state.entries.find((item) => item.id === purchase.ledgerEntryId)!;
    settleException(state, plan, occurrence, effectiveDate, effectiveAmount, entry);
    return entry;
  }
  if (!institution) throw new Error("Selecione uma conta ativa para concluir a cobrança.");
  const entry = recordEntry(state, {
    date: effectiveDate,
    description: occurrence.description,
    amount: effectiveAmount,
    currency: institution.currency,
    brlRate: institution.exchangeRate,
    kind: occurrence.kind,
    categoryId: occurrence.categoryId,
    institutionId: occurrence.institutionId,
    plannedOccurrenceKey: occurrence.key,
    source: "planned",
  });
  settleException(state, plan, occurrence, effectiveDate, effectiveAmount, entry);
  return entry;
}

function settleException(
  state: FinanceState,
  plan: PlannedEntry,
  occurrence: PlannedOccurrence,
  effectiveDate: string,
  effectiveAmount: string,
  entry: { id: string; financialMovementId?: string; date: string; description: string; amount: string; kind: string; categoryId?: string; institutionId?: string; source: string },
) {
  const exception: RecurrenceException = plan.exceptions.find(
    (item) => item.date === occurrence.date,
  ) ?? { date: occurrence.date };
  exception.settledEntryId = entry.id;
  exception.settledMovementId = entry.financialMovementId;
  exception.plannedDate = occurrence.date;
  exception.plannedDescription = occurrence.description;
  exception.plannedAmount = occurrence.amount;
  exception.plannedKind = occurrence.kind;
  exception.plannedCategoryId = occurrence.categoryId;
  exception.plannedInstitutionId = occurrence.institutionId;
  exception.plannedPaymentMethod = occurrence.paymentMethod;
  exception.plannedCreditCardId = occurrence.creditCardId;
  exception.paymentMethod = occurrence.paymentMethod;
  exception.creditCardId = occurrence.creditCardId;
  exception.effectiveDate = effectiveDate;
  exception.effectiveAmount = effectiveAmount;
  exception.generatedFingerprint = plannedEntryFingerprint(entry);
  plan.exceptions = [...plan.exceptions.filter((item) => item.date !== occurrence.date), exception];
  plan.updatedAt = now();
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
  if (!entry) throw new Error("A movimentação realizada não está mais disponível para desfazer.");
  // Realizations created before the planning snapshot was introduced have no
  // fingerprint. Their source and one-leg invariant still prove that they are
  // the untouched automatic entry; only a present fingerprint must match.
  const fingerprintMatches = !exception.generatedFingerprint || exception.generatedFingerprint === plannedEntryFingerprint(entry);
  const isUntouched = movement !== undefined &&
    entry.source === "planned" &&
    movement.source === "planned" &&
    !entry.importedDocumentId &&
    !movement.importedDocumentId &&
    fingerprintMatches &&
    state.entries.filter((item) => item.financialMovementId === movement.id).length === 1;
  const isLegacyUntouched =
    !entry.financialMovementId &&
    entry.source === "planned" &&
    !entry.importedDocumentId &&
    fingerprintMatches;
  if (!isUntouched && !isLegacyUntouched)
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
    Pick<PlannedEntry, "description" | "amount" | "kind" | "categoryId" | "institutionId" | "paymentMethod" | "creditCardId">
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
    if (previous.settledEntryId || state.entries.some((entry) => entry.plannedOccurrenceKey === `${plan.id}:${effectiveDate}`)) throw new Error("Cobrança concluída não pode ser alterada.");
    const exception = {
      ...previous,
      description: changes.description ?? previous.description,
      amount: changes.amount ?? previous.amount,
      kind: changes.kind ?? previous.kind,
      categoryId: changes.categoryId ?? previous.categoryId,
      institutionId: changes.institutionId ?? previous.institutionId,
      paymentMethod: changes.paymentMethod ?? previous.paymentMethod,
      creditCardId: changes.creditCardId ?? previous.creditCardId,
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
