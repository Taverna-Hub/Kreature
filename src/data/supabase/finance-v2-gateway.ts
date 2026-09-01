import { getSupabase } from "./client";

export type DecimalText = string;

export type FinanceV2EventKind =
  | "income"
  | "expense"
  | "internal_transfer"
  | "currency_exchange"
  | "investment_transaction"
  | "investment_income"
  | "card_transaction"
  | "credit_card_payment"
  | "adjustment"
  | "opening_balance";

export type FinanceV2Source = "manual" | "import" | "planned";
export type FinanceV2Flow = "income" | "expense";

/** Everything the boundary decrypts arrives under `sensitive`; ciphertext never reaches the client. */
type Sealed<T> = { sensitive: T; sensitiveUnavailable?: boolean };

export type FinanceV2Posting = {
  ledgerAccountId: string;
  amount: DecimalText;
  currencyCode: string;
  operationFxRateId?: string;
};

export type FinanceV2Bootstrap = {
  profile: {
    display_name: string;
    mascot: Record<string, unknown>;
    theme: "light" | "dark" | "system";
    reporting_currency_code: string;
    created_at: string;
    updated_at: string;
  };
  categories: Array<{
    id: string;
    name: string;
    icon: string;
    color: string;
    flow: FinanceV2Flow;
    image_path: string | null;
    is_default: boolean;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  financial_institutions: Array<{
    id: string;
    slug: string;
    name: string;
    bank_code: string | null;
    logo_key: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    foreground_color: string | null;
  }>;
};

export type FinanceV2AccountSensitive = {
  name?: string;
  agency?: string;
  accountNumber?: string;
  identifier?: string;
  notes?: string;
  catalogSlug?: string;
};

export type FinanceV2Account = Sealed<FinanceV2AccountSensitive> & {
  id: string;
  version: number;
  institution_id: string | null;
  ledger_account_id: string;
  kind: "bank" | "brokerage" | "wallet" | "exchange" | "crypto_wallet" | "other";
  currency_code: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceV2AccountCommand = {
  operation: "create" | "update" | "delete";
  id?: string;
  expectedVersion?: number;
  account?: {
    institutionId?: string;
    kind: FinanceV2Account["kind"];
    currencyCode: string;
    archivedAt?: string;
    sensitive: FinanceV2AccountSensitive;
  };
};

export type FinanceV2CardSensitive = {
  name?: string;
  lastFour?: string;
  cardholderName?: string;
  issuerName?: string;
  notes?: string;
  catalogSlug?: string;
};

export type FinanceV2Card = Sealed<FinanceV2CardSensitive> & {
  id: string;
  version: number;
  institution_id: string | null;
  linked_account_id: string | null;
  kind: "credit" | "debit";
  network: string;
  currency_code: string;
  liability_ledger_account_id: string | null;
  payer_account_id: string | null;
  credit_limit: string | null;
  closing_day: number | null;
  due_day: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceV2CardCommand = {
  operation: "create" | "update" | "delete";
  id?: string;
  expectedVersion?: number;
  card?: {
    institutionId?: string;
    linkedAccountId?: string;
    payerAccountId?: string;
    kind: "credit" | "debit";
    network: "visa" | "mastercard" | "elo" | "amex" | "hipercard" | "other";
    currencyCode: string;
    creditLimit?: DecimalText;
    closingDay?: number;
    dueDay?: number;
    archivedAt?: string;
    sensitive: FinanceV2CardSensitive;
  };
};

export type FinanceV2InvestmentAssetSensitive = {
  name?: string;
  ticker?: string;
  applicationType?: string;
  contractedYield?: string;
  maturityDate?: string;
  notes?: string;
  /** The v1 taxonomy is finer than the catalog's asset types; it round trips here. */
  investmentType?: string;
  quoteMessage?: string;
};

export type FinanceV2InvestmentAsset = Sealed<FinanceV2InvestmentAssetSensitive> & {
  id: string;
  version: number;
  instrument_id: string | null;
  asset_type_code: string;
  currency_code: string;
  holding_id: string | null;
  custody_account_id: string | null;
  ledger_account_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceV2InvestmentAssetCommand = {
  operation: "create" | "update" | "delete";
  id?: string;
  holdingId?: string;
  expectedVersion?: number;
  asset?: {
    instrumentId?: string;
    assetTypeCode: string;
    currencyCode: string;
    custodyAccountId: string;
    archivedAt?: string;
    sensitive: FinanceV2InvestmentAssetSensitive;
  };
};

export type FinanceV2RecurrenceRuleSensitive = { description?: string; notes?: string };

export type FinanceV2RecurrenceRule = Sealed<FinanceV2RecurrenceRuleSensitive> & {
  id: string;
  version: number;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  flow: FinanceV2Flow;
  frequency: "once" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
  start_date: string;
  end_date: string | null;
  occurrence_count: number | null;
  amount: string;
  currency_code: string;
  payment_method: "pix" | "automatic_debit" | "credit_card";
  created_at: string;
  updated_at: string;
};

export type FinanceV2RecurrenceRuleCommand = {
  operation: "create" | "update" | "delete";
  id?: string;
  expectedVersion?: number;
  rule?: {
    categoryId?: string;
    accountId?: string;
    cardId?: string;
    flow: FinanceV2Flow;
    frequency: FinanceV2RecurrenceRule["frequency"];
    startDate: string;
    endDate?: string;
    occurrenceCount?: number;
    amount: DecimalText;
    currencyCode: string;
    paymentMethod: FinanceV2RecurrenceRule["payment_method"];
    sensitive: FinanceV2RecurrenceRuleSensitive;
  };
};

export type FinanceV2PlannedOccurrenceSensitive = {
  description?: string;
  categoryId?: string;
  accountId?: string;
  cardId?: string;
  deleted?: boolean;
};

export type FinanceV2PlannedOccurrence = Sealed<FinanceV2PlannedOccurrenceSensitive> & {
  id: string;
  recurrence_rule_id: string;
  scheduled_for: string;
  status: "scheduled" | "cancelled" | "settled";
  settled_event_id: string | null;
  effective_at: string | null;
  effective_amount: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceV2ClassificationRule = Sealed<{ match?: string }> & {
  id: string;
  category_id: string;
  flow: FinanceV2Flow;
  created_at: string;
  updated_at: string;
};

export type FinanceV2ImportBatchSensitive = {
  source?: string;
  contentHash?: string;
  cardId?: string;
  institutionId?: string;
  closingDate?: string;
  dueDate?: string;
  total?: DecimalText;
};

export type FinanceV2ImportBatch = Sealed<FinanceV2ImportBatchSensitive> & {
  id: string;
  kind: "account_statement" | "card_statement" | "card_invoice";
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceV2EventSensitive = {
  description?: string;
  notes?: string;
  fingerprint?: string;
  plannedOccurrenceKey?: string;
  transferGroupId?: string;
  /** The invoice a payment settles; it identifies a cycle, not an amount. */
  invoiceKey?: string;
  /** Groups the installments of one purchase back into one purchase. */
  purchaseId?: string;
  /** A statement can show installment k of n without revealing the purchase. */
  installmentNumber?: number;
  totalInstallments?: number;
};

export type FinanceV2Event = Sealed<FinanceV2EventSensitive> & {
  id: string;
  version: number;
  kind: FinanceV2EventKind;
  category_id: string | null;
  import_batch_id: string | null;
  occurred_at: string;
  source: FinanceV2Source;
  postings: Array<{
    id: string;
    ledger_account_id: string;
    amount: string;
    currency_code: string;
    operation_fx_rate_id: string | null;
  }>;
  card: {
    card_id: string;
    kind: "purchase" | "refund" | "fee" | "interest";
    installment_number: number | null;
    total_installments: number | null;
    first_invoice_month: string | null;
  } | null;
  investment: {
    transaction_id: string;
    asset_id: string;
    holding_id: string;
    operation: string;
    traded_at: string;
    settled_at: string | null;
    quantity: string | null;
    unit_price: string | null;
    principal_amount: string | null;
    income_amount: string | null;
  } | null;
  investment_income: {
    id: string;
    asset_id: string;
    holding_id: string | null;
    kind: string;
    payment_date: string;
    gross_amount: string;
    withheld_tax: string;
    currency_code: string;
    reinvestment_transaction_id: string | null;
  } | null;
  created_at: string;
  updated_at: string;
};

/** Income, expense, transfer and adjustment. The api resolves the ledger legs. */
export type FinanceV2CashEventCommand = {
  operation: "create" | "update" | "delete";
  id?: string;
  expectedVersion?: number;
  event?: {
    kind: "income" | "expense" | "internal_transfer" | "adjustment" | "opening_balance";
    source?: FinanceV2Source;
    occurredAt: string;
    amount: DecimalText;
    accountId: string;
    counterpartAccountId?: string;
    categoryId?: string;
    importBatchId?: string;
    increasesBalance?: boolean;
    sensitive: FinanceV2EventSensitive;
  };
};

export type FinanceV2EventCommand = {
  operation: "create" | "update" | "delete";
  id?: string;
  expectedVersion?: number;
  event?: {
    kind: FinanceV2EventKind;
    occurredAt: string;
    categoryId?: string;
    importBatchId?: string;
    source: FinanceV2Source;
    sensitive: FinanceV2EventSensitive;
  };
  postings?: FinanceV2Posting[];
  audit?: Record<string, unknown>;
};

export type FinanceV2CardTransactionCommand = {
  cardId: string;
  kind?: "purchase" | "refund" | "fee" | "interest";
  amount: DecimalText;
  installments?: number;
  occurredAt: string;
  firstInvoiceMonth?: string;
  event: {
    source?: FinanceV2Source;
    categoryId?: string;
    importBatchId?: string;
    sensitive: FinanceV2EventSensitive;
  };
};

export type FinanceV2InvestmentCharge = {
  kind?: "brokerage" | "exchange_fee" | "custody_fee" | "tax" | "iof" | "other";
  amount: DecimalText;
};

/**
 * Buy, sell, contribution, redemption, custody transfer and income, each one a
 * single balanced event. Position, average price and return are replayed from
 * these, so nothing here writes a snapshot.
 */
export type FinanceV2InvestmentOperationCommand = {
  operation: "buy" | "sell" | "contribution" | "redemption" | "transfer" | "income" | "opening";
  eventId?: string;
  pairedEventId?: string;
  holdingId: string;
  destinationHoldingId?: string;
  cashAccountId?: string;
  tradedAt: string;
  settledAt?: string;
  quantity?: DecimalText;
  unitPrice?: DecimalText;
  principalAmount?: DecimalText;
  incomeAmount?: DecimalText;
  grossAmount?: DecimalText;
  withheldTax?: DecimalText;
  incomeKind?: "dividend" | "jcp" | "interest" | "yield" | "distribution" | "amortization" | "staking_reward" | "other";
  paymentDate?: string;
  exDate?: string;
  recordDate?: string;
  reinvest?: boolean;
  charges?: FinanceV2InvestmentCharge[];
  event: {
    source?: FinanceV2Source;
    categoryId?: string;
    importBatchId?: string;
    sensitive: FinanceV2EventSensitive;
  };
};

export type FinanceV2InvestmentPosition = {
  holding_id: string;
  asset_id: string;
  custody_account_id: string;
  ledger_account_id: string;
  asset_type_code: string;
  currency_code: string;
  quantity: string;
  cost_basis: string;
  average_price: string | null;
  realized_result: string;
  income_gross: string;
  income_withheld: string;
  custody_balance: string;
  unit_price: string | null;
  price_observed_at: string | null;
  market_value: string;
};

export type FinanceV2FxRate = {
  id: string;
  base_currency_code: string;
  quote_currency_code: string;
  rate: string;
  observed_at: string;
  source: string;
};

export type FinanceV2AccountBalance = { account_id: string; currency_code: string; balance: string };
export type FinanceV2CardBalance = { card_id: string; currency_code: string; balance: string };
export type FinanceV2CardInvoice = {
  card_id: string;
  invoice_month: string;
  currency_code: string;
  total: string;
  transaction_count: number;
};

/**
 * One round trip assembled from the same explicit projections as the individual
 * lists. Nothing here is a `select *`: every field below is named by a contract.
 */
export type FinanceV2Snapshot = FinanceV2Bootstrap & {
  accounts: FinanceV2Account[];
  cards: FinanceV2Card[];
  investment_assets: FinanceV2InvestmentAsset[];
  investment_positions: FinanceV2InvestmentPosition[];
  classification_rules: FinanceV2ClassificationRule[];
  recurrence_rules: FinanceV2RecurrenceRule[];
  planned_occurrences: FinanceV2PlannedOccurrence[];
  import_batches: FinanceV2ImportBatch[];
  fx_rates: FinanceV2FxRate[];
  events: FinanceV2Event[];
};

type FunctionEnvelope<T> = { data?: T; error?: string; code?: string };

/**
 * The only seam the application has to v2. Callers never learn ciphertext, key
 * versions, RPC names or the private schema layout.
 */
export class SupabaseFinanceV2Gateway {
  private async call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await getSupabase().functions.invoke<FunctionEnvelope<T>>("finance-v2", {
      body: { action, ...payload },
    });
    if (error) throw new Error(await describeInvokeError(error));
    if (!data) throw new Error("A camada financeira não respondeu.");
    if (data.error) throw new Error(data.error);
    return data.data as T;
  }

  bootstrap() {
    return this.call<FinanceV2Bootstrap>("bootstrap");
  }

  snapshot(options: { limit?: number } = {}) {
    return this.call<FinanceV2Snapshot>("snapshot", options);
  }

  async writeProfile(profile: Partial<FinanceV2Bootstrap["profile"]>) {
    await this.call<{ ok: true }>("write-profile", { profile });
  }

  async writeCategory(command: {
    operation: "create" | "update" | "delete";
    id?: string;
    category?: Partial<FinanceV2Bootstrap["categories"][number]>;
  }) {
    const result = await this.call<{ category_id: string } | null>("write-category", { command });
    if (!result?.category_id) throw new Error("A categoria não retornou confirmação.");
    return result.category_id;
  }

  writeAccount(command: FinanceV2AccountCommand) {
    return this.call<{ account_id: string; account_version: number }>("write-account", { command });
  }

  listAccounts() {
    return this.call<FinanceV2Account[]>("list-accounts");
  }

  writeCard(command: FinanceV2CardCommand) {
    return this.call<{ card_id: string; card_version: number }>("write-card", { command });
  }

  listCards() {
    return this.call<FinanceV2Card[]>("list-cards");
  }

  writeInvestmentAsset(command: FinanceV2InvestmentAssetCommand) {
    return this.call<{ asset_id: string; holding_id: string | null; asset_version: number }>(
      "write-investment-asset",
      { command },
    );
  }

  listInvestmentAssets() {
    return this.call<FinanceV2InvestmentAsset[]>("list-investment-assets");
  }

  writeRecurrenceRule(command: FinanceV2RecurrenceRuleCommand) {
    return this.call<{ rule_id: string; rule_version: number }>("write-recurrence-rule", { command });
  }

  listRecurrenceRules() {
    return this.call<FinanceV2RecurrenceRule[]>("list-recurrence-rules");
  }

  writePlannedOccurrence(command: {
    operation?: "upsert" | "delete";
    id?: string;
    occurrence: {
      recurrenceRuleId: string;
      scheduledFor: string;
      status?: "scheduled" | "cancelled" | "settled";
      settledEventId?: string;
      effectiveAt?: string;
      effectiveAmount?: DecimalText;
      sensitive?: FinanceV2PlannedOccurrenceSensitive;
    };
  }) {
    return this.call<string>("write-planned-occurrence", { command });
  }

  listPlannedOccurrences() {
    return this.call<FinanceV2PlannedOccurrence[]>("list-planned-occurrences");
  }

  writeClassificationRule(command: {
    operation: "create" | "update" | "delete";
    id?: string;
    rule?: { match: string; categoryId: string; flow: FinanceV2Flow };
  }) {
    return this.call<{ rule_id: string } | null>("write-classification-rule", { command });
  }

  listClassificationRules() {
    return this.call<FinanceV2ClassificationRule[]>("list-classification-rules");
  }

  /** Idempotent by fingerprint: importing the same statement twice returns the first batch. */
  writeImportBatch(command: {
    operation?: "create" | "delete";
    id?: string;
    batch?: {
      kind: FinanceV2ImportBatch["kind"];
      fingerprint: string;
      periodStart?: string;
      periodEnd?: string;
      sensitive: FinanceV2ImportBatchSensitive;
    };
  }) {
    return this.call<{ batch_id: string; created: boolean }>("write-import-batch", { command });
  }

  listImportBatches() {
    return this.call<FinanceV2ImportBatch[]>("list-import-batches");
  }

  importBatchExists(fingerprint: string) {
    return this.call<{ batchId: string | null }>("import-batch-exists", { fingerprint });
  }

  listEvents(options: { limit?: number; before?: string; since?: string } = {}) {
    return this.call<FinanceV2Event[]>("list-events", options);
  }

  writeCashEvent(command: FinanceV2CashEventCommand) {
    return this.call<{ event_id: string; event_version: number }>("write-cash-event", { command });
  }

  writeEvent(command: FinanceV2EventCommand) {
    return this.call<{ event_id: string; event_version: number }>("write-event", { command });
  }

  writeCardTransaction(command: FinanceV2CardTransactionCommand) {
    return this.call<{ event_ids: string[]; first_invoice_month: string }>("write-card-transaction", { command });
  }

  payCardInvoice(command: {
    cardId: string;
    accountId: string;
    amount: DecimalText;
    occurredAt: string;
    eventId?: string;
    event?: { source?: FinanceV2Source; sensitive: FinanceV2EventSensitive };
  }) {
    return this.call<string>("pay-card-invoice", { command });
  }

  cardInvoices() {
    return this.call<FinanceV2CardInvoice[]>("card-invoices");
  }

  writeInvestmentOperation(command: FinanceV2InvestmentOperationCommand) {
    return this.call<{
      event_id: string;
      paired_event_id: string | null;
      transaction_id: string | null;
      paired_transaction_id: string | null;
      income_event_id: string | null;
    }>("write-investment-operation", { command });
  }

  deleteInvestmentOperation(eventId: string) {
    return this.call<number>("delete-investment-operation", { eventId });
  }

  investmentPositions() {
    return this.call<FinanceV2InvestmentPosition[]>("investment-positions");
  }

  writeAssetQuote(command: { assetId: string; unitPrice: DecimalText; observedAt?: string }) {
    return this.call<string>("write-asset-quote", { command });
  }

  accountBalances() {
    return this.call<FinanceV2AccountBalance[]>("account-balances");
  }

  cardBalances() {
    return this.call<FinanceV2CardBalance[]>("card-balances");
  }

  listFxRates() {
    return this.call<FinanceV2FxRate[]>("list-fx-rates");
  }

  writeFxRate(command: {
    baseCurrencyCode: string;
    quoteCurrencyCode: string;
    rate: DecimalText;
    observedAt?: string;
    source?: "manual" | "market" | "import";
  }) {
    return this.call<string>("write-fx-rate", { command });
  }
}

/**
 * supabase-js collapses a non-2xx Edge Function reply into one generic message,
 * so the body carries the reason the boundary actually gave.
 */
async function describeInvokeError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // The body was not the envelope we expect; fall through to the generic message.
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Não foi possível falar com a camada financeira.";
}
