import type { Category, FinanceState } from "./types";
import { DEFAULT_PROFILE } from "@/features/profile/types";

export const now = () => new Date().toISOString();
/** Supabase rows use UUID primary keys. The prefix is kept only for call-site readability. */
export const uid = (prefix: string): string => {
  void prefix;
  return crypto.randomUUID();
};

const categorySeed: Array<[string, string, string, Category["flow"]]> = [
  ["Moradia", "Home", "#f97316", "expense"],
  ["Alimentação", "Utensils", "#0d9488", "expense"],
  ["Transporte", "Car", "#0ea5e9", "expense"],
  ["Saúde", "HeartPulse", "#ec4899", "expense"],
  ["Educação", "GraduationCap", "#8b5cf6", "expense"],
  ["Lazer", "Sparkles", "#eab308", "expense"],
  ["Assinaturas", "Repeat2", "#6366f1", "expense"],
  ["Compras", "ShoppingBag", "#f43f5e", "expense"],
  ["Outros", "CircleEllipsis", "#64748b", "expense"],
  ["Salário", "Wallet", "#34d399", "income"],
  ["Aluguel recebido", "House", "#14b8a6", "income"],
  ["Freela e serviços", "BriefcaseBusiness", "#8b5cf6", "income"],
  ["Vendas", "Store", "#f59e0b", "income"],
  ["Rendimentos", "ChartNoAxesCombined", "#0ea5e9", "income"],
  ["Benefícios", "Gift", "#ec4899", "income"],
  ["Reembolsos", "RotateCcw", "#22c55e", "income"],
  ["Outras receitas", "CircleEllipsis", "#64748b", "income"],
];

export function defaultCategories(timestamp = now()): Category[] {
  return categorySeed.map(([name, icon, color, flow], index) => ({
    id: `default-${flow}-${index + 1}`,
    name,
    icon,
    color,
    flow,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function emptyFinanceState(): FinanceState {
  return {
    categories: defaultCategories(),
    classificationRules: [],
    institutions: [],
    entries: [],
    financialMovements: [],
    investments: [],
    creditCards: [],
    cardPurchases: [],
    importedDocuments: [],
    plannedEntries: [],
    profile: DEFAULT_PROFILE,
    theme: "light",
  };
}
