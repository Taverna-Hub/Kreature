import { describe, expect, it } from "vitest";
import type { FinanceV2Bootstrap, FinanceV2EventCommand } from "./finance-v2-gateway";

describe("FinanceV2EventCommand", () => {
  it("keeps sensitive text out of ledger postings", () => {
    const command: FinanceV2EventCommand = {
      operation: "create",
      event: {
        kind: "expense",
        occurredAt: "2026-09-01T12:00:00.000Z",
        source: "manual",
        sensitive: { description: "Farmácia" },
      },
      postings: [
        { ledgerAccountId: "expense", amount: "-20", currencyCode: "BRL" },
        { ledgerAccountId: "cash", amount: "20", currencyCode: "BRL" },
      ],
    };

    expect(command.postings?.every((posting) => !("description" in posting))).toBe(true);
  });
});

describe("FinanceV2Bootstrap", () => {
  it("keeps the category surface plaintext and excludes encrypted account payloads", () => {
    const bootstrap: FinanceV2Bootstrap = {
      profile: { display_name: "Ana", mascot: {}, theme: "light", reporting_currency_code: "BRL", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      categories: [{ id: "category", name: "Moradia", icon: "Home", color: "#f97316", flow: "expense", image_path: null, is_default: true, archived_at: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" }],
      financial_institutions: [],
    };

    expect(bootstrap.categories[0].name).toBe("Moradia");
    expect(JSON.stringify(bootstrap)).not.toContain("sensitive_payload");
  });
});
