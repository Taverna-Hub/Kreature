import type { ProfileConfig } from "@/profile/types";

export type CurrencyCode = string;
export type DecimalValue = string;
export type ThemeMode = "light" | "dark" | "system";
export type InstitutionType = "bank" | "broker" | "wallet" | "other";
export type EntryKind =
  | "income"
  | "expense"
  | "investment"
  | "reserve"
  | "transfer"
  | "pix"
  | "card_purchase"
  | "credit_payment"
  | "adjustment";
export type InvestmentType =
  | "cdb"
  | "cri"
  | "cra"
  | "fixed_income"
  | "stock"
  | "fii"
  | "etf"
  | "bdr"
  | "crypto"
  | "fund"
  | "pension"
  | "other";
export type RecurrenceFrequency = "once" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  image?: Blob;
  isDefault: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Institution {
  id: string;
  name: string;
  type: InstitutionType;
  bankCode?: string;
  agency?: string;
  accountNumber?: string;
  identifier?: string;
  notes?: string;
  currency: CurrencyCode;
  openingBalance: DecimalValue;
  exchangeRate: DecimalValue;
  exchangeRateAsOf?: string;
  /** Local catalog metadata is optional so records created before the catalog remain valid. */
  catalogId?: InstitutionCatalogId;
  logoKey?: InstitutionLogoKey;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type InstitutionCatalogId =
  | "nubank"
  | "itau"
  | "inter"
  | "bradesco"
  | "santander"
  | "banco-do-brasil"
  | "caixa"
  | "c6"
  | "btg-pactual"
  | "xp"
  | "rico"
  | "clear"
  | "mercado-pago"
  | "picpay"
  | "neon"
  | "wise";

export type InstitutionLogoKey = InstitutionCatalogId | "other";

export interface LedgerEntry {
  id: string;
  date: string;
  description: string;
  amount: DecimalValue;
  currency: CurrencyCode;
  brlAmount: DecimalValue;
  kind: EntryKind;
  categoryId?: string;
  institutionId?: string;
  transferGroupId?: string;
  investmentId?: string;
  assetId?: string;
  creditCardId?: string;
  cardPurchaseId?: string;
  invoiceKey?: string;
  plannedOccurrenceKey?: string;
  source: "manual" | "import" | "planned" | "reconciliation";
  ignoredFromAnalytics: boolean;
  notes?: string;
  fingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCard {
  id: string;
  name: string;
  issuer?: InstitutionCatalogId | "other";
  issuerName?: string;
  payerInstitutionId?: string;
  limit: DecimalValue;
  closingDay: number;
  dueDay: number;
  currency: CurrencyCode;
  notes?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardPurchase {
  id: string;
  cardId: string;
  description: string;
  amount: DecimalValue;
  currency: CurrencyCode;
  date: string;
  categoryId?: string;
  installments: number;
  /** A zero based invoice sequence is derived from the purchase's billing cycle. */
  firstInvoiceKey: string;
  notes?: string;
  ledgerEntryId: string;
  createdAt: string;
  updatedAt: string;
}

export type AssetKind = "reserve" | "traded" | "crypto" | "property" | "vehicle" | "other";

export interface AssetBase {
  id: string;
  kind: AssetKind;
  name: string;
  currentValue: DecimalValue;
  acquisitionValue: DecimalValue;
  currency: CurrencyCode;
  institutionId?: string;
  notes?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveAsset extends AssetBase {
  kind: "reserve";
}

export interface TradedAsset extends AssetBase {
  kind: "traded" | "crypto";
  investmentType: InvestmentType;
  ticker?: string;
  quantity: DecimalValue;
  averagePrice: DecimalValue;
  currentPrice: DecimalValue;
  dividends: DecimalValue;
  contractedYield?: string;
  maturityDate?: string;
  quoteStatus: "manual" | "ok" | "error";
  quoteMessage?: string;
  quoteAsOf?: string;
}

export interface PropertyAsset extends AssetBase {
  kind: "property";
  location?: string;
  acquisitionDate?: string;
}

export interface VehicleAsset extends AssetBase {
  kind: "vehicle";
  make?: string;
  model?: string;
  year?: number;
}

export interface OtherAsset extends AssetBase {
  kind: "other";
}

export type Asset = ReserveAsset | TradedAsset | PropertyAsset | VehicleAsset | OtherAsset;

export interface DerivedInstitutionAsset {
  id: string;
  kind: "institution-account";
  institutionId: string;
  name: string;
  currentValue: DecimalValue;
  acquisitionValue: DecimalValue;
  currency: CurrencyCode;
}

export interface Investment {
  id: string;
  institutionId?: string;
  type: InvestmentType;
  name: string;
  ticker?: string;
  quantity: DecimalValue;
  averagePrice: DecimalValue;
  investedAmount: DecimalValue;
  currentPrice: DecimalValue;
  currentValue: DecimalValue;
  dividends: DecimalValue;
  currency: CurrencyCode;
  contractedYield?: string;
  maturityDate?: string;
  quoteStatus: "manual" | "ok" | "error";
  quoteMessage?: string;
  quoteAsOf?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurrenceException {
  date: string;
  deleted?: boolean;
  description?: string;
  amount?: DecimalValue;
  kind?: "income" | "expense";
  categoryId?: string;
  institutionId?: string;
  settledEntryId?: string;
}

export interface PlannedEntry {
  id: string;
  startDate: string;
  description: string;
  amount: DecimalValue;
  kind: "income" | "expense";
  categoryId?: string;
  institutionId?: string;
  frequency: RecurrenceFrequency;
  endDate?: string;
  occurrenceCount?: number;
  exceptions: RecurrenceException[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportCandidate {
  id: string;
  date: string;
  description: string;
  amount: DecimalValue;
  currency: CurrencyCode;
  /** Identifier supplied by a statement (OFX FITID, CSV operation ID, etc.). */
  externalId?: string;
  detectedInstitutionId?: InstitutionCatalogId;
  parser: string;
  exchangeRate?: DecimalValue;
  kind: EntryKind;
  categoryId?: string;
  institutionId?: string;
  confidence: number;
  reason: string;
  source: string;
  include: boolean;
  createInvestment: boolean;
  fingerprint: string;
  duplicate: boolean;
  similarDuplicate?: boolean;
}

export interface FinanceState {
  categories: Category[];
  institutions: Institution[];
  entries: LedgerEntry[];
  investments: Investment[];
  /** Financial assets replace the old investments collection; investments stays for legacy snapshots. */
  assets: Asset[];
  creditCards: CreditCard[];
  cardPurchases: CardPurchase[];
  plannedEntries: PlannedEntry[];
  profile: ProfileConfig;
  theme: ThemeMode;
}

export interface PeriodFilter {
  mode: "month" | "year" | "all" | "custom";
  month?: number;
  year?: number;
  startDate?: string;
  endDate?: string;
}

export interface Summary {
  expenses: DecimalValue;
  income: DecimalValue;
  available: DecimalValue;
  invested: DecimalValue;
  categoryTotals: Array<{ categoryId?: string; name: string; color: string; amount: DecimalValue }>;
}
