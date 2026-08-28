import { describe, expect, it } from "vitest";
import { emptyFinanceState } from "./defaults";
import {
  institutionBalance,
  reconcileInstitution,
  recordEntry,
  removeEntry,
  transfer,
  updateEntry,
} from "./ledger";
import { buildSummary, monthlyHistory } from "./queries";
import { editRecurrence, occurrencesFor, settleOccurrence } from "./recurrence";

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
