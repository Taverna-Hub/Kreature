import { describe, expect, it } from "vitest";
import { emptyFinanceState } from "./defaults";
import {
  institutionBalance,
  investmentContribution,
  investmentIncome,
  investmentWithdrawal,
  reconcileInstitution,
  recordEntry,
  removeEntry,
  transfer,
  updateEntry,
} from "./ledger";
import { buildSummary, monthlyHistory } from "./queries";
import { editRecurrence, occurrencesFor, settleOccurrence, undoOccurrence } from "./recurrence";

const institution = (id: string, openingBalance = "1000") => ({
  id,
  name: id,
  type: "bank" as const,
  currency: "BRL",
  openingBalance,
  exchangeRate: "1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});

const investment = (id: string, currentValue = "0", investedAmount = "0") => ({
  id, type: "cash_box" as const, name: id, quantity: currentValue === "0" ? "0" : "1",
  averagePrice: investedAmount, investedAmount, currentPrice: currentValue, currentValue, dividends: "0",
  currency: "BRL", quoteStatus: "manual" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01",
});


describe("movimentos patrimoniais", () => {
  it("trata aporte como troca patrimonial, sem despesa", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank", "5000"));
    state.investments.push(investment("cdb"));
    investmentContribution(state, { fromInstitutionId: "bank", investmentId: "cdb", amount: "1000", date: "2026-08-01" });
    expect(institutionBalance(state, "bank")).toBe("4000");
    expect(state.investments[0]).toMatchObject({ currentValue: "1000", investedAmount: "1000" });
    expect(buildSummary(state, { mode: "all" })).toMatchObject({ expenses: "0", income: "0", available: "4000", invested: "1000" });
  });

  it("mantém uma aplicação legada fora das despesas antes da migration ser aplicada", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank", "5000"));
    state.entries.push({
      id: "legacy-application", date: "2026-08-01", description: "Aplicação CDB", amount: "-1000", brlAmount: "-1000",
      currency: "BRL", kind: "investment", institutionId: "bank", source: "import", ignoredFromAnalytics: false,
      createdAt: "2026-08-01", updatedAt: "2026-08-01",
    });

    expect(buildSummary(state, { mode: "all" })).toMatchObject({ expenses: "0", income: "0", available: "4000" });
  });

  it("separa principal e rendimento no resgate pelo custo médio", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank", "0"));
    state.investments.push(investment("cdb", "1100", "1000"));
    const result = investmentWithdrawal(state, { toInstitutionId: "bank", investmentId: "cdb", amount: "1100", date: "2026-08-02" });
    expect(result).toMatchObject({ principal: "1000", income: "100" });
    expect(institutionBalance(state, "bank")).toBe("1100");
    expect(buildSummary(state, { mode: "all" })).toMatchObject({ income: "100", expenses: "0", available: "1100", invested: "0" });
  });

  it("reconhece rendimento em conta ou reinvestido", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank", "0"));
    state.investments.push(investment("cdb", "1000", "1000"));
    investmentIncome(state, { investmentId: "cdb", toInstitutionId: "bank", amount: "50", date: "2026-08-03" });
    investmentIncome(state, { investmentId: "cdb", reinvest: true, amount: "25", date: "2026-08-04" });
    expect(institutionBalance(state, "bank")).toBe("50");
    expect(state.investments[0]).toMatchObject({ currentValue: "1025", dividends: "75" });
    expect(buildSummary(state, { mode: "all" }).income).toBe("75");
  });
});

describe("FinanceLedger", () => {
  it("mantém o saldo correto ao criar, editar e excluir um lançamento", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    const entry = recordEntry(state, {
      date: "2026-01-10",
      description: "Mercado",
      amount: "100",
      currency: "BRL",
      kind: "expense",
      institutionId: "bank",
    });
    expect(institutionBalance(state, "bank")).toBe("900");
    updateEntry(state, entry.id, {
      date: "2026-01-10",
      description: "Mercado",
      amount: "40",
      currency: "BRL",
      kind: "expense",
      institutionId: "bank",
    });
    expect(institutionBalance(state, "bank")).toBe("960");
    removeEntry(state, entry.id);
    expect(institutionBalance(state, "bank")).toBe("1000");
  });

  it("mantém uma categoria de despesa sempre negativa, mesmo em tipo ambíguo", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    const expense = state.categories.find((item) => item.flow === "expense")!;
    const entry = recordEntry(state, {
      date: "2026-01-10",
      description: "Pix da padaria",
      amount: "80",
      currency: "BRL",
      kind: "pix",
      categoryId: expense.id,
      institutionId: "bank",
    });
    expect(entry.amount).toBe("-80");
    expect(institutionBalance(state, "bank")).toBe("920");
  });

  it("mantém uma categoria de receita positiva no mesmo tipo ambíguo", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    const income = state.categories.find((item) => item.flow === "income")!;
    const entry = recordEntry(state, {
      date: "2026-01-10",
      description: "Pix recebido",
      amount: "-80",
      currency: "BRL",
      kind: "pix",
      categoryId: income.id,
      institutionId: "bank",
    });
    expect(entry.amount).toBe("80");
    expect(institutionBalance(state, "bank")).toBe("1080");
  });

  it("corrige o sinal também ao editar o lançamento", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    const expense = state.categories.find((item) => item.flow === "expense")!;
    const entry = recordEntry(state, {
      date: "2026-01-10",
      description: "Pix",
      amount: "30",
      currency: "BRL",
      kind: "pix",
      institutionId: "bank",
    });
    expect(entry.amount).toBe("30");
    const updated = updateEntry(state, entry.id, {
      date: "2026-01-10",
      description: "Pix",
      amount: "30",
      currency: "BRL",
      kind: "pix",
      categoryId: expense.id,
      institutionId: "bank",
    });
    expect(updated.amount).toBe("-30");
    expect(institutionBalance(state, "bank")).toBe("970");
  });

  it("registra transferência em duas pontas sem alterar entradas ou despesas", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("a"), institution("b", "50"));
    transfer(state, {
      fromInstitutionId: "a",
      toInstitutionId: "b",
      amount: "250",
      date: "2026-02-01",
    });
    expect(institutionBalance(state, "a")).toBe("750");
    expect(institutionBalance(state, "b")).toBe("300");
    expect(buildSummary(state, { mode: "all" })).toMatchObject({ income: "0", expenses: "0" });
  });

  it("reconcilia o saldo com um ajuste rastreável", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    reconcileInstitution(state, "bank", "1234.56", "2026-03-01", "Conferência");
    expect(institutionBalance(state, "bank")).toBe("1234.56");
    expect(state.entries[0]).toMatchObject({
      kind: "adjustment",
      amount: "234.56",
      source: "reconciliation",
    });
  });

  it("inclui Pix importado categorizado nos gastos e no gráfico", () => {
    const state = emptyFinanceState();
    const food = state.categories.find((item) => item.name === "Alimentação")!;
    state.entries.push({
      id: "pix-market",
      date: "2026-05-14",
      description: "Pix enviado · Mercado",
      amount: "-52.5",
      brlAmount: "-52.5",
      currency: "BRL",
      kind: "pix",
      categoryId: food.id,
      source: "import",
      ignoredFromAnalytics: false,
      createdAt: "2026-05-14",
      updatedAt: "2026-05-14",
    });

    expect(buildSummary(state, { mode: "month", month: 5, year: 2026 })).toMatchObject({
      expenses: "52.5",
      categoryTotals: [expect.objectContaining({ categoryId: food.id, amount: "52.5" })],
    });
  });
});

describe("histórico mensal", () => {
  it("separa entradas e saídas pelo sinal, inclusive Pix importado", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    recordEntry(state, {
      date: "2026-05-28",
      description: "Pix recebido",
      amount: "200",
      currency: "BRL",
      kind: "pix",
      institutionId: "bank",
      source: "import",
    });
    recordEntry(state, {
      date: "2026-05-29",
      description: "Pix enviado",
      amount: "-75",
      currency: "BRL",
      kind: "pix",
      institutionId: "bank",
      source: "import",
    });

    expect(monthlyHistory(state)).toEqual([
      expect.objectContaining({ month: "2026-05", income: "200", expenses: "75", balance: "125" }),
    ]);
  });
});

describe("recorrências", () => {
  it("ajusta o dia mensal ao último dia válido e realiza uma ocorrência uma única vez", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    const plan = {
      id: "rent",
      startDate: "2026-01-31",
      description: "Aluguel",
      amount: "500",
      kind: "expense" as const,
      institutionId: "bank",
      frequency: "monthly" as const,
      occurrenceCount: 3,
      exceptions: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    state.plannedEntries.push(plan);
    expect(occurrencesFor(plan, "2026-01-01", "2026-04-30").map((item) => item.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    const first = settleOccurrence(state, "rent", "2026-01-31");
    const second = settleOccurrence(state, "rent", "2026-01-31");
    expect(second.id).toBe(first.id);
    expect(state.entries).toHaveLength(1);
  });

  it("edita uma ocorrência ou divide somente as futuras", () => {
    const state = emptyFinanceState();
    const plan = {
      id: "salary",
      startDate: "2026-01-10",
      description: "Salário",
      amount: "3000",
      kind: "income" as const,
      categoryId: "work",
      frequency: "monthly" as const,
      occurrenceCount: 4,
      exceptions: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    state.plannedEntries.push(plan);

    editRecurrence(
      state,
      plan.id,
      "2026-02-10",
      { description: "Freela", kind: "expense", categoryId: "extra" },
      "one",
    );
    expect(occurrencesFor(plan, "2026-02-10", "2026-02-10")[0]).toMatchObject({
      description: "Freela",
      kind: "expense",
      categoryId: "extra",
    });

    const split = editRecurrence(
      state,
      plan.id,
      "2026-03-10",
      { amount: "3500" },
      "future",
    );
    expect(state.plannedEntries.find((item) => item.id === plan.id)?.endDate).toBe("2026-03-09");
    expect(split).toMatchObject({ startDate: "2026-03-10", amount: "3500" });
  });
});

describe("realização planejada", () => {
  it("preserva previsto, registra data efetiva e desfaz o movimento automático", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    state.plannedEntries.push({ id: "rent-effective", startDate: "2026-08-30", description: "Aluguel", amount: "1500", kind: "income", institutionId: "bank", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const entry = settleOccurrence(state, "rent-effective", "2026-08-30", { effectiveDate: "2026-08-29", effectiveAmount: "1490" });
    const exception = state.plannedEntries[0].exceptions[0];
    expect(entry.date).toBe("2026-08-29");
    expect(exception).toMatchObject({ plannedDate: "2026-08-30", plannedAmount: "1500", effectiveDate: "2026-08-29", effectiveAmount: "1490" });
    undoOccurrence(state, "rent-effective", "2026-08-30");
    expect(state.entries).toHaveLength(0);
    expect(state.plannedEntries[0].exceptions[0].settledEntryId).toBeUndefined();
  });

  it("bloqueia undo quando a realização foi editada", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    state.plannedEntries.push({ id: "protected", startDate: "2026-08-20", description: "Conta", amount: "10", kind: "expense", institutionId: "bank", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const entry = settleOccurrence(state, "protected", "2026-08-20", { effectiveDate: "2026-08-20" });
    updateEntry(state, entry.id, { date: entry.date, description: "Conta corrigida", amount: "10", currency: "BRL", kind: "expense", institutionId: "bank" });
    expect(() => undoOccurrence(state, "protected", "2026-08-20")).toThrow("Não é possível desfazer");
    expect(state.entries).toHaveLength(1);
  });

  it("desfaz uma realização legada que ainda preserva o movimento automático", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    state.plannedEntries.push({ id: "legacy-planned", startDate: "2026-08-20", description: "Aluguel", amount: "1500", kind: "expense", institutionId: "bank", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    settleOccurrence(state, "legacy-planned", "2026-08-20", { effectiveDate: "2026-08-20" });
    delete state.plannedEntries[0].exceptions[0].generatedFingerprint;

    undoOccurrence(state, "legacy-planned", "2026-08-20");

    expect(state.entries).toHaveLength(0);
    expect(state.plannedEntries[0].exceptions[0].settledEntryId).toBeUndefined();
  });

  it("desfaz uma realização anterior ao cabeçalho de movimento", () => {
    const state = emptyFinanceState();
    state.institutions.push(institution("bank"));
    state.plannedEntries.push({ id: "legacy-without-header", startDate: "2026-08-20", description: "Aluguel", amount: "1500", kind: "expense", institutionId: "bank", frequency: "once", exceptions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const entry = settleOccurrence(state, "legacy-without-header", "2026-08-20", { effectiveDate: "2026-08-20" });
    state.financialMovements = [];
    delete entry.financialMovementId;
    delete state.plannedEntries[0].exceptions[0].generatedFingerprint;

    undoOccurrence(state, "legacy-without-header", "2026-08-20");

    expect(state.entries).toHaveLength(0);
  });
});
