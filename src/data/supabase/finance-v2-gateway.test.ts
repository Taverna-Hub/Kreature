import { describe, expect, it, vi } from "vitest";
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


const invoke = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ getSupabase: () => ({ functions: { invoke } }) }));
import { SupabaseFinanceV2Gateway, type FinanceV2Event } from "./finance-v2-gateway";

it("loads more than 1000 events with identical timestamps without loss", async () => {
  const events: FinanceV2Event[] = Array.from({ length: 2032 }, (_, i) => ({
    id: String(2032 - i).padStart(8, "0"), occurred_at: "2026-09-14T02:30:00Z", version: 1,
    kind: "expense", category_id: null, import_batch_id: null, source: "manual", sensitive: {}, postings: [],
    card: null, investment: null, investment_income: null, created_at: "2026-09-14T02:30:00Z", updated_at: "2026-09-14T02:30:00Z",
  }));
  invoke.mockReset();
  invoke.mockImplementation(async (_name, { body }) => {
    if (body.action === "snapshot") return { data: { data: { events: events.slice(0, body.limit) } } };
    expect(body.before).toBe("2026-09-14T02:30:00Z");
    const start = events.findIndex(event => event.id === body.beforeId) + 1;
    expect(start).toBeGreaterThan(0);
    return { data: { data: events.slice(start, start + body.limit) } };
  });
  const result = await new SupabaseFinanceV2Gateway().snapshot();
  expect(result.events.map(event => event.id)).toEqual(events.map(event => event.id));
  expect(invoke).toHaveBeenCalledTimes(3);
});
