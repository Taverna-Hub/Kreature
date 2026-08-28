import type { Category, FinanceState } from "./types";
import { DEFAULT_PROFILE } from "@/profile/types";

export const now = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const categorySeed: Array<[string, string, string]> = [
  ["Moradia", "Home", "#f97316"],
  ["Alimentação", "Utensils", "#0d9488"],
  ["Transporte", "Car", "#0ea5e9"],
  ["Saúde", "HeartPulse", "#ec4899"],
  ["Educação", "GraduationCap", "#8b5cf6"],
  ["Lazer", "Sparkles", "#eab308"],
  ["Salário", "Wallet", "#34d399"],
  ["Investimentos", "TrendingUp", "#1e40af"],
  ["Outros", "CircleEllipsis", "#64748b"],
];

export function defaultCategories(timestamp = now()): Category[] {
  return categorySeed.map(([name, icon, color], index) => ({
    id: `default-${index + 1}`,
    name,
    icon,
    color,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function emptyFinanceState(): FinanceState {
  return {
    categories: defaultCategories(),
    institutions: [],
    entries: [],
    investments: [],
    assets: [],
    creditCards: [],
    cardPurchases: [],
    plannedEntries: [],
    profile: DEFAULT_PROFILE,
    theme: "light",
  };
}
