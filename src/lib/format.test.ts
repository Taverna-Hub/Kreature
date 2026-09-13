import { describe, expect, it } from "vitest";
import { compactMoney, compactPercentage, dateLabel, transactionDayLabel } from "@/lib/format";

describe("transactionDayLabel", () => {
  it("formata dias úteis de forma curta em UTC", () => {
    expect(transactionDayLabel("2026-09-25")).toBe("Sex - 25 de Set");
  });

  it("mantém a data correta no fim de semana e não altera dateLabel", () => {
    expect(transactionDayLabel("2026-11-01")).toBe("Dom - 01 de Nov");
    expect(dateLabel("2026-11-01")).toBe("01/11/2026");
  });
});


describe("compact financial comparisons", () => {
  it.each([
    ["532.45", "R$ 532"], ["1253.42", "R$ 1,3k"], ["20396.09", "R$ 20k"],
    ["1250000", "R$ 1,3 mi"], ["0", "R$ 0"], ["-1253.42", "-R$ 1,3k"],
    ["999.5", "R$ 1k"], ["9999", "R$ 10k"], ["999999", "R$ 1 mi"],
  ])("formats %s as %s", (value, expected) => expect(compactMoney(value)).toBe(expected));
  it.each([["383.1", "383%"], ["36.9", "37%"], ["-36.9", "-37%"], ["0", "0%"]])(
    "rounds %s to %s", (value, expected) => expect(compactPercentage(value)).toBe(expected),
  );
  it("presents timestamps on their Recife day while preserving civil dates", () => {
    expect(dateLabel("2026-09-14T02:59:59Z")).toBe("13/09/2026");
    expect(transactionDayLabel("2026-09-14T02:59:59Z")).toBe(transactionDayLabel("2026-09-13"));
  });
});
