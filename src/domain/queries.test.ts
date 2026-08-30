import { describe, expect, it } from "vitest";
import { previousMonthAbbreviation } from "./queries";

describe("comparativo mensal", () => {
  it.each([
    [8, "jul"],
    [9, "ago"],
    [1, "dez"],
    [12, "nov"],
  ] as const)("usa a referência de três letras para o mês %s", (month, expected) => {
    expect(previousMonthAbbreviation({ mode: "month", month, year: 2026 })).toBe(expected);
  });
});
