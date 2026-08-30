import { describe, expect, it } from "vitest";
import { cardNetworkDetails, normalizeCardNetwork } from "./card-brands";

describe("bandeiras de cartão", () => {
  it("normaliza os nomes legados para os valores persistidos", () => {
    expect(normalizeCardNetwork("Visa")).toBe("visa");
    expect(normalizeCardNetwork("MasterCard")).toBe("mastercard");
    expect(normalizeCardNetwork("Elo")).toBe("elo");
  });

  it("resolve o SVG correspondente à bandeira", () => {
    expect(cardNetworkDetails("visa")?.logoPath).toContain("card_banner/");
    expect(cardNetworkDetails("mastercard")?.label).toBe("MasterCard");
    expect(cardNetworkDetails("elo")?.logoPath).toBe("/card_banner/elo-30.svg");
  });
});
