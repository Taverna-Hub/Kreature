import Decimal from "decimal.js";
import { now, uid } from "./defaults";
import { institutionBalance } from "./ledger";
import type { Asset, DerivedInstitutionAsset, FinanceState, Investment } from "./types";

function investmentToAsset(investment: Investment): Asset {
  return {
    id: investment.id,
    kind: investment.type === "crypto" ? "crypto" : "traded",
    name: investment.name,
    currentValue: investment.currentValue,
    acquisitionValue: investment.investedAmount,
    currency: investment.currency,
    institutionId: investment.institutionId,
    ticker: investment.ticker,
    investmentType: investment.type,
    quantity: investment.quantity,
    averagePrice: investment.averagePrice,
    currentPrice: investment.currentPrice,
    dividends: investment.dividends,
    contractedYield: investment.contractedYield,
    maturityDate: investment.maturityDate,
    quoteStatus: investment.quoteStatus,
    quoteMessage: investment.quoteMessage,
    quoteAsOf: investment.quoteAsOf,
    archivedAt: investment.archivedAt,
    createdAt: investment.createdAt,
    updatedAt: investment.updatedAt,
  };
}

/** Normalizes all persisted versions into the runtime state without dropping legacy records. */
export function normalizeFinanceState(value: Partial<FinanceState>): FinanceState {
  const legacyInvestments = value.investments ?? [];
  const assets = value.assets?.length
    ? value.assets
    : legacyInvestments.map(investmentToAsset);
  return {
    ...value,
    categories: value.categories ?? [],
    institutions: value.institutions ?? [],
    entries: value.entries ?? [],
    investments: legacyInvestments,
    assets,
    creditCards: value.creditCards ?? [],
    cardPurchases: value.cardPurchases ?? [],
    plannedEntries: value.plannedEntries ?? [],
    profile: value.profile!,
    theme: value.theme ?? "light",
  };
}

export function derivedInstitutionAssets(state: FinanceState): DerivedInstitutionAsset[] {
  return state.institutions
    .filter((institution) => !institution.archivedAt)
    .map((institution) => {
      const balance = institutionBalance(state, institution.id);
      return {
        id: `institution:${institution.id}`,
        kind: "institution-account" as const,
        institutionId: institution.id,
        name: institution.name,
        currentValue: balance,
        acquisitionValue: institution.openingBalance,
        currency: institution.currency,
      };
    });
}

export function createAsset(
  state: FinanceState,
  input: Omit<Asset, "id" | "createdAt" | "updatedAt">,
): Asset {
  const timestamp = now();
  const asset = { ...input, id: uid("asset"), createdAt: timestamp, updatedAt: timestamp } as Asset;
  if (new Decimal(asset.currentValue).isNegative() || new Decimal(asset.acquisitionValue).isNegative())
    throw new Error("Os valores de patrimônio não podem ser negativos.");
  state.assets.push(asset);
  return asset;
}
