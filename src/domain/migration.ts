import Decimal from "decimal.js";
import { classifyTransaction, reclassifyEntries } from "./classification";
import { defaultCategories, now } from "./defaults";
import type { FinanceState } from "./types";

export const CATEGORY_TAXONOMY_VERSION = 4;

export function migrateCategoryTaxonomy(state: FinanceState) {
  state.categories = defaultCategories(now());
  state.classificationRules = [];
  reclassifyEntries(state);
  state.plannedEntries.forEach((plan) => {
    const classify = (description: string, amount: string, kind: "income" | "expense") =>
      classifyTransaction(
        description,
        (kind === "expense" ? new Decimal(amount).abs().negated() : new Decimal(amount).abs()).toString(),
        state.categories,
      );
    plan.categoryId = classify(plan.description, plan.amount, plan.kind).categoryId;
    plan.exceptions = plan.exceptions.map((exception) => {
      if (exception.deleted) return { ...exception, categoryId: undefined };
      const kind = exception.kind ?? plan.kind;
      return {
        ...exception,
        categoryId: classify(exception.description ?? plan.description, exception.amount ?? plan.amount, kind).categoryId,
      };
    });
  });
}
