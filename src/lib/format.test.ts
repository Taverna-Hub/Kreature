import { describe, expect, it } from "vitest";
import { dateLabel, transactionDayLabel } from "@/lib/format";

describe("transactionDayLabel", () => {
  it("formata dias úteis de forma curta em UTC", () => {
    expect(transactionDayLabel("2026-09-25")).toBe("Sex - 25 de Set");
  });

  it("mantém a data correta no fim de semana e não altera dateLabel", () => {
    expect(transactionDayLabel("2026-11-01")).toBe("Dom - 01 de Nov");
    expect(dateLabel("2026-11-01")).toBe("01/11/2026");
  });
});
