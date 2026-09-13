import Decimal from "decimal.js";
import type { LedgerEntry } from "./types";
import { normalizeClassificationText } from "./classification";
import { businessDate, businessToday } from "@/lib/temporal";

export type LaunchPeriod = { mode: "current" } | { mode: "history" } | { mode: "month"; month: string };
export type LaunchKind = "all" | "income" | "expense" | "card";

/** A single filtered set drives rows, counts and day totals, before pagination. */
export function selectLaunches(entries: LedgerEntry[], period: LaunchPeriod, search = "", kind: LaunchKind = "all", today = businessToday()) {
  const groups = new Set<string>();
  const query = normalizeClassificationText(search);
  return entries.filter((entry) => {
    if (entry.systemGenerated) return false;
    const date = businessDate(entry.date);
    if (period.mode === "month" ? date.slice(0, 7) !== period.month : date > today || (period.mode === "current" && date.slice(0, 7) !== today.slice(0, 7))) return false;
    const group = entry.financialMovementId ?? entry.transferGroupId;
    if (group && groups.has(group)) return false;
    if (group) groups.add(group);
    if (!normalizeClassificationText(entry.description).includes(query)) return false;
    return kind === "all" || (kind === "card" ? entry.kind === "card_purchase" || entry.paymentMethod === "credit_card" :
      kind === "income" ? new Decimal(entry.amount).isPositive() : new Decimal(entry.amount).isNegative() && entry.kind !== "card_purchase");
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
