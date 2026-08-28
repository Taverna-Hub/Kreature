import { describe, expect, it } from "vitest";
import { emptyFinanceState } from "./defaults";
import { investmentDisplayGroups } from "./investment-groups";

const importedRdb = (id: string, institutionId = "bank") => ({
  id,
  institutionId,
  type: "other" as const,
  name: "Aplicação RDB",
  quantity: "1",
  averagePrice: "100",
  investedAmount: "100",
  currentPrice: "100",
  currentValue: "100",
  dividends: "0",
  currency: "BRL",
  quoteStatus: "manual" as const,
  quoteMessage: "Criado pela importação",
  createdAt: "2026-05-01",
  updatedAt: "2026-05-01",
});

describe("investmentDisplayGroups", () => {
  it("consolida RDBs importados da mesma instituição e mostra seus lançamentos", () => {
    const state = emptyFinanceState();
    state.investments.push(importedRdb("rdb-a"), importedRdb("rdb-b"), importedRdb("other-bank", "other"));
    state.entries.push({
      id: "entry-a",
      date: "2026-05-12",
      description: "Aplicação RDB",
      amount: "-100",
      brlAmount: "-100",
      currency: "BRL",
      kind: "investment",
      institutionId: "bank",
      source: "import",
      ignoredFromAnalytics: false,
      createdAt: "2026-05-12",
      updatedAt: "2026-05-12",
    });

    const groups = investmentDisplayGroups(state);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.id === "rdb:bank:aplicacao rdb")).toMatchObject({
      investments: [{ id: "rdb-a" }, { id: "rdb-b" }],
      history: [{ id: "entry-a" }],
    });
  });

  it("mantém investimentos manuais como posições separadas", () => {
    const state = emptyFinanceState();
    state.investments.push({ ...importedRdb("imported"), quoteMessage: undefined }, importedRdb("imported-2"));

    expect(investmentDisplayGroups(state)).toHaveLength(2);
  });
});
