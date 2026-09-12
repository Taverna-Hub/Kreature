import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiCard } from "@/shared/ui/KpiCard";

describe("KpiCard", () => {
  it("renderiza valor, tom e informação auxiliar com semântica consistente", () => {
    const { container } = render(
      <KpiCard
        label="Entradas"
        value="R$ 1.250,00"
        tone="income"
        supporting="↑ R$ 250,00 vs. ago."
        supportingTone="up"
        supportingLabel="Variação positiva em relação a agosto"
        className="summary-total"
      />,
    );

    const card = container.querySelector("article");
    expect(card).toHaveClass("metric", "income", "summary-total");
    expect(screen.getByText("Entradas")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.250,00")).toBeInTheDocument();
    expect(screen.getByLabelText("Variação positiva em relação a agosto")).toHaveClass("metric-comparison", "up");
  });
});
