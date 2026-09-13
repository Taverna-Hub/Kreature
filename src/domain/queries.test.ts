import { describe, expect, it } from "vitest";
import { previousMonthAbbreviation } from "./queries";

describe("comparativo mensal", () => {
  it.each([
    [8, "Jul"],
    [9, "Ago"],
    [1, "Dez"],
    [12, "Nov"],
  ] as const)("usa a referência de três letras para o mês %s", (month, expected) => {
    expect(previousMonthAbbreviation({ mode: "month", month, year: 2026 })).toBe(expected);
  });
});
