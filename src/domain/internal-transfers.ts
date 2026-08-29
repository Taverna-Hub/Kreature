import Decimal from "decimal.js";
import type { FinanceState, ImportCandidate, LedgerEntry } from "./types";

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const daysApart = (left: string, right: string) => Math.abs((Date.parse(`${left.slice(0, 10)}T12:00:00`) - Date.parse(`${right.slice(0, 10)}T12:00:00`)) / 86_400_000);

function mentionsAccount(description: string, account: { name: string; identifier?: string; accountNumber?: string }) {
  const text = normalized(description);
  return [account.name, account.identifier, account.accountNumber]
    .filter((value): value is string => Boolean(value && value.length >= 3))
    .some((value) => text.includes(normalized(value)));
}

/**
 * Finds only an unambiguous opposite leg already known to the user. It never
 * converts a candidate; the review UI must still ask for confirmation.
 */
export function suggestInternalTransfer(state: FinanceState, candidate: ImportCandidate): ImportCandidate {
  if (!candidate.institutionId || !state.institutions.some((item) => item.id === candidate.institutionId)) return candidate;
  const source = state.institutions.find((item) => item.id === candidate.institutionId)!;
  const matches = state.entries.filter((entry) => {
    if (!entry.institutionId || entry.institutionId === source.id || entry.pendingReconciliation) return false;
    const account = state.institutions.find((item) => item.id === entry.institutionId);
    if (!account || account.currency !== candidate.currency) return false;
    if (!new Decimal(entry.amount).abs().eq(new Decimal(candidate.amount).abs())) return false;
    if (new Decimal(entry.amount).isNegative() === new Decimal(candidate.amount).isNegative()) return false;
    if (daysApart(entry.date, candidate.date) > 1) return false;
    return mentionsAccount(candidate.description, account) || mentionsAccount(entry.description, source);
  });
  if (matches.length !== 1) return candidate;
  const match: LedgerEntry = matches[0];
  return {
    ...candidate,
    counterpartyInstitutionId: match.institutionId,
    internalTransferSuggestion: { confidence: 0.9, reason: "PossÃ­vel transferÃªncia entre suas contas; confirme a conta de destino." },
  };
}
