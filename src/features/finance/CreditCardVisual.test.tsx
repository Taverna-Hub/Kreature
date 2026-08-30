import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { compactCardholderName, CreditCardVisual } from "./CreditCardVisual";

describe("visual do cartão", () => {
  it.each([
    ["THOMAZ RODRIGUES LIMA", "THOMAZ R LIMA"],
    ["Sophia Galindo Rodrigues", "Sophia G Rodrigues"],
    ["Ana Lima", "Ana Lima"],
  ])("compacta o titular sem perder o primeiro e o último nome", (name, expected) => {
    expect(compactCardholderName(name)).toBe(expected);
  });

  it("mantém chip e número em áreas distintas no layout responsivo", () => {
    const { container } = render(<CreditCardVisual card={{
      id: "card", name: "Cartão Itaú", issuer: "itau", lastFour: "0772", network: "mastercard", cardType: "credit",
      limit: "1000", closingDay: 10, dueDay: 20, currency: "BRL", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }} />);

    expect(container.querySelector(".credit-card-middle .credit-card-number")).toBeNull();
    expect(container.querySelector(".credit-card-middle .credit-card-chip")).not.toBeNull();
    expect(container.querySelector(".credit-card-visual > .credit-card-number")).not.toBeNull();
  });
});
