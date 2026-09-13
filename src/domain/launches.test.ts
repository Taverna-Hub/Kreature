import { describe, expect, it } from "vitest";
import { selectLaunches } from "./launches";
import type { LedgerEntry } from "./types";
const entry = (id: string, date: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, date, description: "Mercado", amount: "-10", brlAmount: "-10", currency: "BRL", kind: "expense",
  source: "manual", ignoredFromAnalytics: false, createdAt: "2026-09-13T15:00:00Z", updatedAt: "2026-09-13T15:00:00Z", ...extra,
});
const today = "2026-09-13";
const entries = [entry("today", today), entry("later", "2026-09-20"), entry("oct", "2026-10-13"), entry("nov", "2026-11-13"), entry("past", "2026-08-13")];
describe("movement query", () => {
  it("opens current month through today", () => expect(selectLaunches(entries, { mode: "current" }, "", "all", today).map(e => e.id)).toEqual(["today"]));
  it("explicit current month includes later days", () => expect(selectLaunches(entries, { mode: "month", month: "2026-09" }, "", "all", today).map(e => e.id)).toEqual(["later", "today"]));
  it("explicit October only includes October", () => expect(selectLaunches(entries, { mode: "month", month: "2026-10" }, "", "all", today).map(e => e.id)).toEqual(["oct"]));
  it("history stops today", () => expect(selectLaunches(entries, { mode: "history" }, "", "all", today).map(e => e.id)).toEqual(["today", "past"]));
  it("counts and paginates after search, kind, date and deduplication", () => {
    const data = [...Array.from({ length: 32 }, (_, i) => entry(`${i}`, today)), ...entries.slice(1),
      entry("income", today, { amount: "10", kind: "income" }), entry("other", today, { description: "Farmácia" }),
      entry("duplicate", today, { financialMovementId: "group" }), entry("second-leg", today, { financialMovementId: "group" }),
      entry("system", today, { systemGenerated: true })];
    const filtered = selectLaunches(data, { mode: "current" }, "mercado", "expense", today);
    expect(filtered).toHaveLength(33);
    expect(filtered.slice(0, 25)).toHaveLength(25);
    expect(filtered.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(-330);
  });
});
