import { beforeEach, describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";
import { institutionBalance, movementsFor } from "@/domain/ledger";
import { buildSummary } from "@/domain/queries";
import { cardInvoices } from "@/domain/cards";
import { SupabaseFinanceV2Repository, type FinanceV2Api } from "./finance-v2-repository";
import type { FinanceV2Snapshot } from "./finance-v2-gateway";

vi.mock("./client", () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    storage: { from: () => ({ download: async () => ({ data: null }), upload: async () => ({ error: null }), remove: async () => ({}) }) },
  }),
}));

const CHECKING_LEDGER = "ledger-checking";
const BROKER_LEDGER = "ledger-broker";
const CUSTODY_LEDGER = "ledger-custody";
const CARD_LEDGER = "ledger-card";
const SYSTEM_LEDGER = "ledger-system";

const timestamps = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

function snapshot(overrides: Partial<FinanceV2Snapshot> = {}): FinanceV2Snapshot {
  return {
    profile: { display_name: "Ana", mascot: { nickname: "Ana" }, theme: "dark", reporting_currency_code: "BRL", ...timestamps },
    categories: [
      { id: "cat-food", name: "Alimentação", icon: "Utensils", color: "#0d9488", flow: "expense", image_path: null, is_default: true, archived_at: null, ...timestamps },
      { id: "cat-salary", name: "Salário", icon: "Wallet", color: "#34d399", flow: "income", image_path: null, is_default: true, archived_at: null, ...timestamps },
    ],
    financial_institutions: [
      { id: "org-nubank", slug: "nubank", name: "Nubank", bank_code: "260", logo_key: "nubank", primary_color: null, secondary_color: null, foreground_color: null },
    ],
    accounts: [
      { id: "acc-checking", version: 1, institution_id: "org-nubank", ledger_account_id: CHECKING_LEDGER, kind: "bank", currency_code: "BRL", archived_at: null, sensitive: { name: "Conta Corrente", agency: "0001" }, ...timestamps },
      { id: "acc-broker", version: 1, institution_id: null, ledger_account_id: BROKER_LEDGER, kind: "brokerage", currency_code: "BRL", archived_at: null, sensitive: { name: "Corretora" }, ...timestamps },
    ],
    cards: [
      { id: "card-1", version: 1, institution_id: "org-nubank", linked_account_id: null, kind: "credit", network: "visa", currency_code: "BRL", liability_ledger_account_id: CARD_LEDGER, payer_account_id: "acc-checking", credit_limit: "5000", closing_day: 20, due_day: 28, archived_at: null, sensitive: { name: "Cartão Roxo", lastFour: "4321" }, ...timestamps },
    ],
    investment_assets: [
      { id: "asset-1", version: 1, instrument_id: null, asset_type_code: "stock", currency_code: "BRL", holding_id: "holding-1", custody_account_id: "acc-broker", ledger_account_id: CUSTODY_LEDGER, archived_at: null, sensitive: { name: "Petrobras PN", ticker: "PETR4" }, ...timestamps },
    ],
    investment_positions: [
      { holding_id: "holding-1", asset_id: "asset-1", custody_account_id: "acc-broker", ledger_account_id: CUSTODY_LEDGER, asset_type_code: "stock", currency_code: "BRL", quantity: "120", cost_basis: "1284", average_price: "10.7", realized_result: "127", income_gross: "100", income_withheld: "15", custody_balance: "1284", unit_price: "18", price_observed_at: "2026-01-31T12:00:00Z", market_value: "2160" },
    ],
    classification_rules: [
      { id: "rule-1", category_id: "cat-food", flow: "expense", sensitive: { match: "mercado" }, ...timestamps },
    ],
    recurrence_rules: [
      { id: "plan-1", version: 1, category_id: "cat-food", account_id: "acc-checking", card_id: null, flow: "expense", frequency: "monthly", start_date: "2026-01-05", end_date: null, occurrence_count: null, amount: "89.90", currency_code: "BRL", payment_method: "pix", sensitive: { description: "Academia" }, ...timestamps },
    ],
    planned_occurrences: [
      { id: "occ-1", recurrence_rule_id: "plan-1", scheduled_for: "2026-03-05", status: "cancelled", settled_event_id: null, effective_at: null, effective_amount: null, sensitive: { description: "Pulado" }, ...timestamps },
    ],
    import_batches: [
      { id: "batch-1", kind: "account_statement", period_start: "2026-01-01", period_end: "2026-01-31", sensitive: { source: "extrato.ofx", contentHash: "sha256:abc" }, ...timestamps },
    ],
    fx_rates: [],
    events: [
      {
        id: "ev-opening", version: 1, kind: "opening_balance", category_id: null, import_batch_id: null,
        occurred_at: "2026-01-01T12:00:00Z", source: "manual", sensitive: { description: "Saldo inicial" },
        postings: [
          { id: "p1", ledger_account_id: CHECKING_LEDGER, amount: "10000", currency_code: "BRL", operation_fx_rate_id: null },
          { id: "p2", ledger_account_id: SYSTEM_LEDGER, amount: "-10000", currency_code: "BRL", operation_fx_rate_id: null },
        ],
        card: null, investment: null, investment_income: null, ...timestamps,
      },
      {
        id: "ev-expense", version: 1, kind: "expense", category_id: "cat-food", import_batch_id: null,
        occurred_at: "2026-01-05T12:00:00Z", source: "manual", sensitive: { description: "Mercado" },
        postings: [
          { id: "p3", ledger_account_id: CHECKING_LEDGER, amount: "-250.50", currency_code: "BRL", operation_fx_rate_id: null },
          { id: "p4", ledger_account_id: SYSTEM_LEDGER, amount: "250.50", currency_code: "BRL", operation_fx_rate_id: null },
        ],
        card: null, investment: null, investment_income: null, ...timestamps,
      },
      ...[1, 2, 3].map((installment) => ({
        id: `ev-card-${installment}`, version: 1, kind: "card_transaction" as const, category_id: "cat-food",
        import_batch_id: null, occurred_at: "2026-01-10T12:00:00Z", source: "manual" as const,
        sensitive: { description: "Tênis", purchaseId: "purchase-1" },
        postings: [
          { id: `pc${installment}a`, ledger_account_id: SYSTEM_LEDGER, amount: "100", currency_code: "BRL", operation_fx_rate_id: null },
          { id: `pc${installment}b`, ledger_account_id: CARD_LEDGER, amount: "-100", currency_code: "BRL", operation_fx_rate_id: null },
        ],
        card: { card_id: "card-1", kind: "purchase" as const, installment_number: installment, total_installments: 3, first_invoice_month: "2026-01-01" },
        investment: null, investment_income: null, ...timestamps,
      })),
      {
        id: "ev-transfer", version: 1, kind: "internal_transfer", category_id: null, import_batch_id: null,
        occurred_at: "2026-01-06T12:00:00Z", source: "manual", sensitive: { description: "Para a corretora" },
        postings: [
          { id: "p5", ledger_account_id: CHECKING_LEDGER, amount: "-2000", currency_code: "BRL", operation_fx_rate_id: null },
          { id: "p6", ledger_account_id: BROKER_LEDGER, amount: "2000", currency_code: "BRL", operation_fx_rate_id: null },
        ],
        card: null, investment: null, investment_income: null, ...timestamps,
      },
      {
        id: "ev-dividend", version: 1, kind: "investment_income", category_id: null, import_batch_id: null,
        occurred_at: "2026-01-15T12:00:00Z", source: "manual", sensitive: { description: "Dividendo PETR4" },
        postings: [
          { id: "p7", ledger_account_id: BROKER_LEDGER, amount: "85", currency_code: "BRL", operation_fx_rate_id: null },
          { id: "p8", ledger_account_id: SYSTEM_LEDGER, amount: "-85", currency_code: "BRL", operation_fx_rate_id: null },
        ],
        card: null, investment: null,
        investment_income: { id: "inc-1", asset_id: "asset-1", holding_id: "holding-1", kind: "dividend", payment_date: "2026-01-15", gross_amount: "100", withheld_tax: "15", currency_code: "BRL", reinvestment_transaction_id: null },
        ...timestamps,
      },
    ],
    ...overrides,
  } as FinanceV2Snapshot;
}

function fakeGateway(current = snapshot()) {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const record = <T,>(method: string, result: T) => (payload: unknown) => {
    calls.push({ method, payload });
    return Promise.resolve(result);
  };
  const gateway: FinanceV2Api = {
    snapshot: () => Promise.resolve(current),
    writeProfile: record("writeProfile", undefined) as FinanceV2Api["writeProfile"],
    writeCategory: record("writeCategory", "cat-new") as FinanceV2Api["writeCategory"],
    writeAccount: record("writeAccount", { account_id: "acc-new", account_version: 1 }) as FinanceV2Api["writeAccount"],
    writeCard: record("writeCard", { card_id: "card-new", card_version: 1 }) as FinanceV2Api["writeCard"],
    writeInvestmentAsset: record("writeInvestmentAsset", { asset_id: "asset-new", holding_id: "holding-new", asset_version: 1 }) as FinanceV2Api["writeInvestmentAsset"],
    writeRecurrenceRule: record("writeRecurrenceRule", { rule_id: "plan-new", rule_version: 1 }) as FinanceV2Api["writeRecurrenceRule"],
    writePlannedOccurrence: record("writePlannedOccurrence", "occ-new") as FinanceV2Api["writePlannedOccurrence"],
    writeClassificationRule: record("writeClassificationRule", { rule_id: "rule-new" }) as FinanceV2Api["writeClassificationRule"],
    writeImportBatch: record("writeImportBatch", { batch_id: "batch-new", created: true }) as FinanceV2Api["writeImportBatch"],
    writeCashEvent: record("writeCashEvent", { event_id: "ev-new", event_version: 1 }) as FinanceV2Api["writeCashEvent"],
    writeCardTransaction: record("writeCardTransaction", { event_ids: ["ev-c1"], first_invoice_month: "2026-02-01" }) as FinanceV2Api["writeCardTransaction"],
    payCardInvoice: record("payCardInvoice", "ev-pay") as FinanceV2Api["payCardInvoice"],
    writeInvestmentOperation: record("writeInvestmentOperation", { event_id: "ev-inv", paired_event_id: null, transaction_id: "tx", paired_transaction_id: null, income_event_id: null }) as FinanceV2Api["writeInvestmentOperation"],
    deleteInvestmentOperation: record("deleteInvestmentOperation", 1) as FinanceV2Api["deleteInvestmentOperation"],
    writeAssetQuote: record("writeAssetQuote", "quote") as FinanceV2Api["writeAssetQuote"],
    writeFxRate: record("writeFxRate", "fx") as FinanceV2Api["writeFxRate"],
  };
  return { gateway, calls };
}

describe("repositório v2", () => {
  let repository: SupabaseFinanceV2Repository;
  let calls: Array<{ method: string; payload: unknown }>;

  beforeEach(() => {
    const fake = fakeGateway();
    repository = new SupabaseFinanceV2Repository(fake.gateway);
    calls = fake.calls;
  });

  it("projeta contas, cartões e categorias sem expor texto cifrado", async () => {
    const state = await repository.load();

    expect(state.theme).toBe("dark");
    expect(state.institutions.map((item) => item.name)).toEqual(["Conta Corrente", "Corretora"]);
    expect(state.institutions[0]).toMatchObject({ type: "bank", catalogId: "nubank", bankCode: "260", agency: "0001" });
    expect(state.creditCards[0]).toMatchObject({ name: "Cartão Roxo", lastFour: "4321", issuer: "nubank", closingDay: 20 });
    expect(state.classificationRules[0]).toMatchObject({ match: "mercado", categoryId: "cat-food", kind: "expense" });
    expect(state.importedDocuments[0]).toMatchObject({ contentHash: "sha256:abc", periodStart: "2026-01-01" });
    expect(JSON.stringify(state)).not.toContain("sensitive_payload");
  });

  it("deriva o saldo da conta do livro contábil, sem saldo inicial guardado à parte", async () => {
    const state = await repository.load();

    // 10000 opening, 250.50 groceries, 2000 moved to the broker.
    expect(state.institutions[0].openingBalance).toBe("0");
    expect(new Decimal(institutionBalance(state, "acc-checking")).toString()).toBe("7749.5");
    expect(new Decimal(institutionBalance(state, "acc-broker")).toString()).toBe("2085");
  });

  it("apresenta o investimento a partir da posição recalculada", async () => {
    const state = await repository.load();
    const investment = state.investments[0];

    expect(investment).toMatchObject({
      name: "Petrobras PN",
      ticker: "PETR4",
      quantity: "120",
      averagePrice: "10.7",
      investedAmount: "1284",
      currentPrice: "18",
      currentValue: "2160",
      dividends: "100",
      institutionId: "acc-broker",
    });
  });

  it("salva uma reserva em dinheiro sem conta de custódia", async () => {
    await repository.transact((draft) => {
      draft.investments.push({
        id: "cash-reserve", type: "cash_box", name: "Reserva em dinheiro",
        quantity: "1", averagePrice: "1000", investedAmount: "1000", currentPrice: "1000", currentValue: "1000",
        dividends: "0", currency: "BRL", quoteStatus: "manual",
        createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
      });
    });

    expect(calls.find((call) => call.method === "writeInvestmentAsset")?.payload).toMatchObject({
      operation: "create",
      asset: { assetTypeCode: "cash_box", custodyAccountId: undefined },
    });
    expect(calls.find((call) => call.method === "writeInvestmentOperation")?.payload).toMatchObject({
      operation: "opening", principalAmount: "1000",
    });
  });

  it("reagrupa as parcelas de uma compra em uma única compra de cartão", async () => {
    const state = await repository.load();

    expect(state.cardPurchases).toHaveLength(1);
    expect(state.cardPurchases[0]).toMatchObject({
      description: "Tênis",
      amount: "300",
      installments: 3,
      cardId: "card-1",
      firstInvoiceKey: "card-1:2026-01",
    });
    const invoices = cardInvoices(state, "card-1");
    expect(invoices.map((invoice) => invoice.key)).toEqual(["card-1:2026-01", "card-1:2026-02", "card-1:2026-03"]);
    expect(invoices.every((invoice) => invoice.total === "100")).toBe(true);
  });

  it("mantém transferências e aplicações fora das somas de receita e despesa", async () => {
    const state = await repository.load();
    const summary = buildSummary(state, { mode: "month", year: 2026, month: 1 });

    // Groceries plus the three card installments; the transfer is neutral.
    expect(summary.expenses).toBe("550.5");
    expect(summary.income).toBe("100");
    expect(movementsFor(state).filter((movement) => movement.kind === "internal_transfer")).toHaveLength(1);
  });

  it("converte um novo lançamento em um evento de caixa atômico", async () => {
    await repository.transact((draft) => {
      draft.financialMovements.push({
        id: "movement-new", kind: "expense", date: "2026-02-01", description: "Farmácia",
        amount: "42.90", currency: "BRL", brlAmount: "42.90", categoryId: "cat-food",
        source: "manual", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
      });
      draft.entries.push({
        id: "entry-new", date: "2026-02-01", description: "Farmácia", amount: "-42.90", currency: "BRL",
        brlAmount: "-42.90", kind: "expense", categoryId: "cat-food", institutionId: "acc-checking",
        financialMovementId: "movement-new", source: "manual", ignoredFromAnalytics: false,
        createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
      });
    });

    const written = calls.find((call) => call.method === "writeCashEvent");
    expect(written).toBeDefined();
    expect(written?.payload).toMatchObject({
      operation: "create",
      event: { kind: "expense", amount: "42.9", accountId: "acc-checking", categoryId: "cat-food", increasesBalance: false },
    });
    expect(JSON.stringify(written?.payload)).toContain("Farmácia");
  });

  it("converte um resgate em principal e rendimento derivados da posição", async () => {
    await repository.transact((draft) => {
      draft.financialMovements.push({
        id: "movement-redeem", kind: "investment_withdrawal", date: "2026-02-02", description: "Resgate",
        amount: "1080", currency: "BRL", brlAmount: "1080", investmentId: "asset-1",
        source: "manual", createdAt: "2026-02-02T00:00:00Z", updatedAt: "2026-02-02T00:00:00Z",
      });
      draft.entries.push({
        id: "entry-redeem-out", date: "2026-02-02", description: "Resgate", amount: "-1080", currency: "BRL",
        brlAmount: "-1080", kind: "investment_withdrawal", investmentId: "asset-1",
        financialMovementId: "movement-redeem", source: "manual", ignoredFromAnalytics: true,
        createdAt: "2026-02-02T00:00:00Z", updatedAt: "2026-02-02T00:00:00Z",
      });
      draft.entries.push({
        id: "entry-redeem-in", date: "2026-02-02", description: "Resgate", amount: "1080", currency: "BRL",
        brlAmount: "1080", kind: "investment_withdrawal", institutionId: "acc-broker",
        financialMovementId: "movement-redeem", source: "manual", ignoredFromAnalytics: true,
        createdAt: "2026-02-02T00:00:00Z", updatedAt: "2026-02-02T00:00:00Z",
      });
    });

    const operation = calls.find((call) => call.method === "writeInvestmentOperation");
    // Half the market value of 2160 is redeemed, so half the 1284 basis leaves
    // and the rest of the cash is realized yield.
    expect(operation?.payload).toMatchObject({
      operation: "redemption",
      holdingId: "holding-1",
      cashAccountId: "acc-broker",
      principalAmount: "642",
      incomeAmount: "438",
    });
  });

  it("recusa reduzir uma posição editando o valor aplicado", async () => {
    await expect(repository.transact((draft) => {
      draft.investments[0].investedAmount = "100";
    })).rejects.toThrow(/venda ou um resgate/);
  });

  it("registra a compra no cartão como uma transação parcelada, não como partidas soltas", async () => {
    await repository.transact((draft) => {
      draft.financialMovements.push({
        id: "movement-card", kind: "card_purchase", date: "2026-02-03", description: "Fone",
        amount: "600", currency: "BRL", brlAmount: "600", creditCardId: "card-1", paymentMethod: "credit_card",
        source: "manual", createdAt: "2026-02-03T00:00:00Z", updatedAt: "2026-02-03T00:00:00Z",
      });
      draft.entries.push({
        id: "entry-card", date: "2026-02-03", description: "Fone", amount: "-600", currency: "BRL",
        brlAmount: "-600", kind: "card_purchase", creditCardId: "card-1", paymentMethod: "credit_card",
        financialMovementId: "movement-card", source: "manual", ignoredFromAnalytics: false,
        createdAt: "2026-02-03T00:00:00Z", updatedAt: "2026-02-03T00:00:00Z",
      });
      draft.cardPurchases.push({
        id: "purchase-2", cardId: "card-1", ledgerEntryId: "entry-card", description: "Fone",
        amount: "600", currency: "BRL", date: "2026-02-03", installments: 6,
        firstInvoiceKey: "card-1:2026-03", createdAt: "2026-02-03T00:00:00Z", updatedAt: "2026-02-03T00:00:00Z",
      });
    });

    const written = calls.find((call) => call.method === "writeCardTransaction");
    expect(written?.payload).toMatchObject({
      cardId: "card-1", kind: "purchase", amount: "600", installments: 6, firstInvoiceMonth: "2026-03-01",
    });
  });

  it("guarda apenas o lote e a impressão digital de uma importação", async () => {
    await repository.transact((draft) => {
      draft.importedDocuments.push({
        id: "doc-new", kind: "card_invoice", contentHash: "sha256:def", source: "fatura.pdf",
        creditCardId: "card-1", periodStart: "2026-02-01", periodEnd: "2026-02-28",
        createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
      });
    });

    const written = calls.find((call) => call.method === "writeImportBatch");
    const payload = JSON.stringify(written?.payload);
    expect(written?.payload).toMatchObject({ operation: "create", batch: { kind: "card_invoice", fingerprint: "sha256:def" } });
    expect(payload).not.toContain("rawText");
    expect(payload).not.toContain("base64");
  });
});
