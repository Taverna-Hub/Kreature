import { describe, expect, it } from "vitest";
import { classifyTransaction, learnClassificationRule } from "./classification";
import { emptyFinanceState } from "./defaults";
import { migrateCategoryTaxonomy } from "./migration";

describe("classificação local", () => {
  it("prioriza uma regra aprendida de descrição exata", () => {
    const state = emptyFinanceState();
    const compras = state.categories.find((item) => item.name === "Compras")!;
    const alimentacao = state.categories.find((item) => item.name === "Alimentação")!;
    learnClassificationRule(state, {
      id: "manual",
      date: "2026-08-01",
      description: "Mercado Central",
      amount: "-20",
      brlAmount: "-20",
      currency: "BRL",
      kind: "pix",
      categoryId: compras.id,
      source: "manual",
      ignoredFromAnalytics: false,
      createdAt: "2026-08-01",
      updatedAt: "2026-08-01",
    });

    expect(classifyTransaction("Mercado Central", "-40", state.categories, state.classificationRules)).toMatchObject({ kind: "expense", categoryId: compras.id, confidence: .98 });
    expect(classifyTransaction("Mercado do Bairro", "-40", state.categories, state.classificationRules)).toMatchObject({ categoryId: alimentacao.id });
  });

  it("recria a taxonomia e reclassifica o histórico sem apagar lançamentos", () => {
    const state = emptyFinanceState();
    state.entries.push({
      id: "legacy-market",
      date: "2026-05-12",
      description: "Mercado Central",
      amount: "-125",
      brlAmount: "-125",
      currency: "BRL",
      kind: "pix",
      categoryId: "legacy-category",
      source: "import",
      ignoredFromAnalytics: false,
      createdAt: "2026-05-12",
      updatedAt: "2026-05-12",
    });
    state.plannedEntries.push({
      id: "legacy-salary",
      startDate: "2026-06-05",
      description: "Salário empresa",
      amount: "3000",
      kind: "income",
      categoryId: "legacy-category",
      frequency: "monthly",
      exceptions: [],
      createdAt: "2026-05-12",
      updatedAt: "2026-05-12",
    });

    migrateCategoryTaxonomy(state);

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ kind: "expense", categoryId: state.categories.find((item) => item.name === "Alimentação")?.id });
    expect(state.plannedEntries[0].categoryId).toBe(state.categories.find((item) => item.name === "Salário")?.id);
    expect(state.categories.some((item) => item.name === "Aluguel recebido" && item.flow === "income")).toBe(true);
  });
});
