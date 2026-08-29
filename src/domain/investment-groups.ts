import Decimal from "decimal.js";
import type { FinanceState, Investment, LedgerEntry } from "./types";

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function rdbPositionKey(institutionId: string | undefined, name: string) {
  if (!institutionId || !/\brdb\b/.test(normalize(name))) return undefined;
  return `${institutionId}:${normalize(name)}`;
}

export function importedRdbPositionKey(investment: Investment) {
  if (investment.quoteMessage !== "Criado pela importação") return undefined;
  return rdbPositionKey(investment.institutionId, investment.name);
}

/**
 * A bank statement describes cash moving out of or into the account. The investment
 * history describes the inverse: an application grows the position and a redemption
 * shrinks it.
 */
export function investmentMovementAmount(entry: LedgerEntry) {
  if (entry.kind === "investment" || entry.kind === "investment_contribution")
    return new Decimal(entry.brlAmount).abs().toString();
  if (entry.kind === "investment_withdrawal")
    return new Decimal(entry.brlAmount).abs().negated().toString();
  return entry.brlAmount;
}

export interface InvestmentDisplayGroup {
  id: string;
  investments: Investment[];
  history: LedgerEntry[];
}

/** Groups only the RDB positions produced by import; manually created investments remain independent. */
export function investmentDisplayGroups(state: FinanceState): InvestmentDisplayGroup[] {
  const groups = new Map<string, Investment[]>();

  for (const investment of state.investments) {
    if (investment.archivedAt) continue;
    const key = importedRdbPositionKey(investment);
    const groupKey = key ? `rdb:${key}` : `investment:${investment.id}`;
    const current = groups.get(groupKey) ?? [];
    current.push(investment);
    groups.set(groupKey, current);
  }

  return [...groups].map(([id, investments]) => {
    const investmentIds = new Set(investments.map((investment) => investment.id));
    const importedKey = importedRdbPositionKey(investments[0]);
    const history = state.entries
      .filter(
        (entry) =>
          investmentIds.has(entry.investmentId ?? "") ||
          (Boolean(importedKey) &&
            entry.source === "import" &&
            (entry.kind === "investment" || entry.kind === "investment_contribution") &&
            rdbPositionKey(entry.institutionId, entry.description) === importedKey),
      )
      .slice()
      .sort((first, second) => second.date.localeCompare(first.date));

    return { id, investments, history };
  });
}
