import { getSupabase } from "./client";

export type FinanceV2Posting = {
  ledgerAccountId: string;
  amount: string;
  currencyCode: string;
  operationFxRateId?: string;
};

export type FinanceV2EventKind = "income" | "expense" | "internal_transfer" | "currency_exchange" | "investment_transaction" | "investment_income" | "card_transaction" | "credit_card_payment" | "adjustment" | "opening_balance";

export type FinanceV2EventCommand = {
  operation: "create" | "update" | "delete";
  id?: string;
  expectedVersion?: number;
  event?: {
    kind: FinanceV2EventKind;
    occurredAt: string;
    categoryId?: string;
    importBatchId?: string;
    source: "manual" | "import" | "planned";
    /** Encrypted by the Edge Function; never sent to PostgREST in plaintext. */
    sensitive: Record<string, unknown>;
  };
  postings?: FinanceV2Posting[];
  /** Encrypted before persistence in the 90-day revision log. */
  audit?: Record<string, unknown>;
};

export type FinanceV2Event = {
  id: string;
  version: number;
  kind: FinanceV2EventKind;
  categoryId?: string;
  occurredAt: string;
  source: "manual" | "import" | "planned";
  createdAt: string;
  updatedAt: string;
  sensitive: Record<string, unknown>;
};
export type FinanceV2AccountCommand = { operation: "create" | "update" | "delete"; id?: string; expectedVersion?: number; account?: { institutionId?: string; kind: "bank" | "brokerage" | "wallet" | "exchange" | "crypto_wallet" | "other"; currencyCode: string; archivedAt?: string; sensitive: Record<string, unknown> } };
export type FinanceV2CardCommand = { operation: "create" | "update" | "delete"; id?: string; expectedVersion?: number; card?: { institutionId?: string; linkedAccountId?: string; payerAccountId?: string; kind: "credit" | "debit"; network: "visa" | "mastercard" | "elo" | "amex" | "hipercard" | "other"; currencyCode: string; creditLimit?: string; closingDay?: number; dueDay?: number; archivedAt?: string; sensitive: Record<string, unknown> } };
export type FinanceV2InvestmentAssetCommand = { operation: "create" | "update" | "delete"; id?: string; holdingId?: string; expectedVersion?: number; asset?: { instrumentId?: string; assetTypeCode: string; currencyCode: string; custodyAccountId: string; archivedAt?: string; sensitive: Record<string, unknown> } };
export type FinanceV2RecurrenceRuleCommand = { operation: "create" | "update" | "delete"; id?: string; expectedVersion?: number; rule?: { categoryId?: string; accountId?: string; cardId?: string; flow: "income" | "expense"; frequency: "once" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly"; startDate: string; endDate?: string; occurrenceCount?: number; amount: string; currencyCode: string; paymentMethod: "pix" | "automatic_debit" | "credit_card"; sensitive: Record<string, unknown> } };

type FunctionSuccess<T> = { data: T };

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
    flow: "income" | "expense";
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

/**
 * A deliberately small seam for v2. Callers never learn ciphertext, key
 * versions, RPC names, or the private-schema layout.
 */
export class SupabaseFinanceV2Gateway {
  async writeAccount(command: FinanceV2AccountCommand) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<{ account_id: string; account_version: number }>>("finance-v2", { body: { action: "write-account", command } });
    if (error) throw error;
    if (!data?.data) throw new Error("A conta não retornou confirmação.");
    return data.data;
  }

  async writeCard(command: FinanceV2CardCommand) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<{ card_id: string; card_version: number }>>("finance-v2", { body: { action: "write-card", command } });
    if (error) throw error;
    if (!data?.data) throw new Error("O cartão não retornou confirmação.");
    return data.data;
  }

  async writeInvestmentAsset(command: FinanceV2InvestmentAssetCommand) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<{ asset_id: string; holding_id: string; asset_version: number }>>("finance-v2", { body: { action: "write-investment-asset", command } });
    if (error) throw error;
    if (!data?.data) throw new Error("O ativo não retornou confirmação.");
    return data.data;
  }

  async writeRecurrenceRule(command: FinanceV2RecurrenceRuleCommand) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<{ rule_id: string; rule_version: number }>>("finance-v2", { body: { action: "write-recurrence-rule", command } });
    if (error) throw error;
    if (!data?.data) throw new Error("O planejamento não retornou confirmação.");
    return data.data;
  }
  async bootstrap() {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<FinanceV2Bootstrap>>("finance-v2", {
      body: { action: "bootstrap" },
    });
    if (error) throw error;
    if (!data?.data) throw new Error("O bootstrap financeiro não retornou dados.");
    return data.data;
  }

  async writeProfile(profile: Partial<FinanceV2Bootstrap["profile"]>) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<{ ok: true }>>("finance-v2", {
      body: { action: "write-profile", profile },
    });
    if (error) throw error;
    if (!data?.data?.ok) throw new Error("O perfil não foi confirmado.");
  }

  async writeCategory(command: {
    operation: "create" | "update" | "delete";
    id?: string;
    category?: Partial<FinanceV2Bootstrap["categories"][number]>;
  }) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<{ category_id: string }>>("finance-v2", {
      body: { action: "write-category", command },
    });
    if (error) throw error;
    if (!data?.data?.category_id) throw new Error("A categoria não retornou confirmação.");
    return data.data.category_id;
  }

  async listEvents(options: { limit?: number; before?: string } = {}) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<FinanceV2Event[]>>("finance-v2", {
      body: { action: "list-events", ...options },
    });
    if (error) throw error;
    return data?.data ?? [];
  }

  async writeEvent(command: FinanceV2EventCommand) {
    const { data, error } = await getSupabase().functions.invoke<FunctionSuccess<{ event_id: string; event_version: number }>>("finance-v2", {
      body: { action: "write-event", command },
    });
    if (error) throw error;
    if (!data?.data) throw new Error("A operação financeira não retornou confirmação.");
    return data.data;
  }

  async accountBalances() {
    const { data, error } = await getSupabase().rpc("account_balances");
    if (error) throw error;
    return data ?? [];
  }
}
