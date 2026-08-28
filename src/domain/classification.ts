import Decimal from "decimal.js";
import { now, uid } from "./defaults";
import type { Category, CategoryFlow, ClassificationRule, EntryKind, FinanceState, LedgerEntry } from "./types";

export const normalizeClassificationText = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type Classification = { kind: EntryKind; categoryId?: string; confidence: number; reason: string };
type Pattern = { flow: CategoryFlow; category: string; terms: string[] };

const patterns: Pattern[] = [
  { flow: "expense", category: "Alimentação", terms: ["mercado", "restaurante", "ifood", "padaria", "lanche"] },
  { flow: "expense", category: "Transporte", terms: ["uber", "99", "posto", "combustivel", "combustível", "estacionamento"] },
  { flow: "expense", category: "Moradia", terms: ["aluguel", "condominio", "condomínio", "energia", "internet", "agua", "água"] },
  { flow: "expense", category: "Saúde", terms: ["farmacia", "farmácia", "medico", "médico", "hospital", "consulta"] },
  { flow: "expense", category: "Educação", terms: ["curso", "escola", "faculdade", "udemy", "livro"] },
  { flow: "expense", category: "Assinaturas", terms: ["netflix", "spotify", "prime video", "assinatura", "icloud"] },
  { flow: "income", category: "Salário", terms: ["salario", "salário", "remuneracao", "remuneração", "folha"] },
  { flow: "income", category: "Aluguel recebido", terms: ["aluguel recebido", "recebimento aluguel"] },
  { flow: "income", category: "Freela e serviços", terms: ["freela", "freelance", "prestacao de servico", "prestação de serviço"] },
  { flow: "income", category: "Vendas", terms: ["venda", "vendas", "marketplace"] },
  { flow: "income", category: "Rendimentos", terms: ["dividendo", "rendimento", "juros", "provento"] },
  { flow: "income", category: "Benefícios", terms: ["vale", "beneficio", "benefício"] },
  { flow: "income", category: "Reembolsos", terms: ["reembolso", "estorno"] },
];

const categoryFor = (categories: Category[], flow: CategoryFlow, name: string) =>
  categories.find((category) => !category.archivedAt && category.flow === flow && normalizeClassificationText(category.name) === normalizeClassificationText(name));

const isInternal = (text: string) => /transfer/.test(text);
const isInvoicePayment = (text: string) => /pagamento.*fatura|fatura.*paga|pagamento cartao/.test(text);
const isInvestment = (text: string) => /aplicacao|aplicação|investimento|\brdb\b|\bcdb\b|tesouro|caixinha|dinheiro reservado/.test(text);

export function classifyTransaction(description: string, amount: string, categories: Category[], rules: ClassificationRule[] = []): Classification {
  const text = normalizeClassificationText(description);
  const flow: CategoryFlow = new Decimal(amount).isNegative() ? "expense" : "income";
  if (isInvoicePayment(text)) return { kind: "credit_payment", confidence: .9, reason: "Pagamento de fatura identificado" };
  if (isInvestment(text)) return { kind: "investment", confidence: .86, reason: "Aplicação financeira identificada" };
  if (isInternal(text)) return { kind: "transfer", confidence: .8, reason: "Transferência identificada" };

  const learned = rules.find((rule) => rule.match === text && rule.kind === flow && categories.some((category) => category.id === rule.categoryId && !category.archivedAt));
  if (learned) return { kind: flow, categoryId: learned.categoryId, confidence: .98, reason: "Regra local aprendida" };

  const matched = patterns.find((pattern) => pattern.flow === flow && pattern.terms.some((term) => text.includes(normalizeClassificationText(term))));
  const category = matched && categoryFor(categories, matched.flow, matched.category);
  if (category) return { kind: flow, categoryId: category.id, confidence: .86, reason: `Padrão local: ${category.name}` };

  if (/\bpix\b/.test(text)) return { kind: "pix", confidence: .72, reason: "Pix identificado" };
  return { kind: flow, confidence: .62, reason: "Sinal do valor" };
}

export function learnClassificationRule(state: FinanceState, entry: LedgerEntry) {
  if (!entry.categoryId) return;
  const category = state.categories.find((item) => item.id === entry.categoryId && !item.archivedAt);
  if (!category || (category.flow === "expense" && !new Decimal(entry.brlAmount).isNegative()) || (category.flow === "income" && !new Decimal(entry.brlAmount).isPositive())) return;
  state.classificationRules ??= [];
  const match = normalizeClassificationText(entry.description);
  if (!match) return;
  const timestamp = now();
  const existing = state.classificationRules.find((rule) => rule.match === match && rule.kind === category.flow);
  if (existing) Object.assign(existing, { categoryId: entry.categoryId, updatedAt: timestamp });
  else state.classificationRules.push({ id: uid("rule"), match, categoryId: entry.categoryId, kind: category.flow, createdAt: timestamp, updatedAt: timestamp });
}

export function reclassifyEntries(state: FinanceState) {
  for (const entry of state.entries) {
    const classification = classifyTransaction(entry.description, entry.amount, state.categories, state.classificationRules);
    entry.kind = classification.kind;
    entry.categoryId = classification.categoryId;
    entry.ignoredFromAnalytics = classification.kind === "transfer" || classification.kind === "credit_payment";
    entry.updatedAt = now();
  }
}
