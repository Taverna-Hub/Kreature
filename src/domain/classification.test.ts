import { describe, expect, it } from "vitest";
import { classifyTransaction, learnClassificationRule } from "./classification";
import { emptyFinanceState } from "./defaults";

describe("classificação local", () => {
  it("prioriza uma regra aprendida de descrição exata", () => {
    const state = emptyFinanceState();
    const compras = state.categories.find((item) => item.name === "Compras")!;
    const alimentacao = state.categories.find((item) => item.name === "Alimentação")!;
    learnClassificationRule(state, {
      id: "manual", date: "2026-08-01", description: "Mercado Central", amount: "-20", brlAmount: "-20", currency: "BRL", kind: "pix",
      categoryId: compras.id, source: "manual", ignoredFromAnalytics: false, createdAt: "2026-08-01", updatedAt: "2026-08-01",
    });
    expect(classifyTransaction("Mercado Central", "-40", state.categories, state.classificationRules)).toMatchObject({ kind: "expense", categoryId: compras.id, confidence: .98 });
    expect(classifyTransaction("Mercado do Bairro", "-40", state.categories, state.classificationRules)).toMatchObject({ categoryId: alimentacao.id });
  });
});
