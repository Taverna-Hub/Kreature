import { describe, expect, it } from "vitest";
import { dateLabel, transactionDayLabel } from "@/lib/format";

describe("transactionDayLabel", () => {
  it("formata dias úteis de forma curta em UTC", () => {
    expect(transactionDayLabel("2026-09-25")).toBe("sex - 25 set");
  });

  it("mantém a data correta no fim de semana e não altera dateLabel", () => {
    expect(transactionDayLabel("2026-09-27")).toBe("dom - 27 set");
    expect(dateLabel("2026-09-27")).toBe("27/09/2026");
  });
});
